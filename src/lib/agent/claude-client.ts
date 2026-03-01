import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type AccountContext } from "./system-prompt";
import { DEFAULT_SOUL, DEFAULT_AGENT_RULES } from "./default-documents";
import { getToolsForAgent } from "./tool-definitions";
import { executeToolCall } from "./tool-executor";
import {
  saveMessage,
  updateConversationTimestamp,
  getAgentBySlug,
  loadAgentDocument,
} from "./memory";
import { extractAndSaveFacts } from "./fact-extraction";
import type { SupabaseClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

// --- Model Selection (3 Tiers) ---

const MODEL_TIERS = {
  deep: "claude-opus-4-6",
  normal: "claude-sonnet-4-5-20250929",
  basic: "claude-haiku-4-5-20251001",
} as const;

function selectModel(message: string, agentSlug?: string): string {
  // Coordenador sempre usa Sonnet (precisa raciocinar bem para rotear)
  if (agentSlug === "coordenador") return MODEL_TIERS.normal;

  // Deep: estratégia completa, análise profunda, arquitetura, auditoria
  const deepPatterns =
    /estratégia completa|análise profunda|plano de lançamento|arquitetura completa|reestruturar? (todo|tudo|completo)|auditoria completa|análise detalhada/i;
  if (deepPatterns.test(message)) return MODEL_TIERS.deep;

  // Basic: saudações, confirmações, perguntas simples
  const basicPatterns =
    /^(oi|olá|hey|obrigad|valeu|ok|sim|não|beleza|blz|show|legal|entendi|perfeito|bom dia|boa tarde|boa noite|tudo bem|e aí)\b/i;
  if (basicPatterns.test(message)) return MODEL_TIERS.basic;

  // Default: Sonnet
  return MODEL_TIERS.normal;
}

function selectModelByComplexity(complexity: string): string {
  return (
    MODEL_TIERS[complexity as keyof typeof MODEL_TIERS] || MODEL_TIERS.normal
  );
}

// --- Types ---

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStreamParams {
  message: string;
  history: AgentMessage[];
  accountId: string;
  accountContext: AccountContext;
  workspaceId?: string;
  coreMemories?: string;
  supabase?: SupabaseClient;
  conversationId?: string;
  soulContent?: string;
  agentRulesContent?: string;
  userProfileContent?: string;
  agentId?: string;
  agentSlug?: string;
  projectContext?: string;
}

interface Choice {
  label: string;
  value: string;
}

// --- Helpers ---

function extractChoices(text: string): {
  cleanText: string;
  choices: Choice[] | null;
} {
  const regex = /<choices>\s*(\[[\s\S]*?\])\s*<\/choices>/;
  const match = text.match(regex);

  if (!match) {
    return { cleanText: text, choices: null };
  }

  try {
    const choices = JSON.parse(match[1]) as Choice[];
    const cleanText = text.replace(regex, "").trim();
    return { cleanText, choices };
  } catch {
    return { cleanText: text, choices: null };
  }
}

// --- Specialist Runner (sub-agent, non-streaming) ---

export interface SpecialistParams {
  agentSlug: string;
  task: string;
  context?: string;
  complexity?: string;
  accountId: string;
  accountContext: AccountContext;
  workspaceId: string;
  supabase: SupabaseClient;
  projectContext?: string;
  maxLoops?: number;
  maxTokens?: number;
}

export interface SpecialistResult {
  text: string;
  model: string;
  agentName: string;
  agentColor: string;
}

export async function runSpecialist(
  params: SpecialistParams
): Promise<SpecialistResult> {
  // 1. Find agent in DB
  const agent = await getAgentBySlug(
    params.supabase,
    params.workspaceId,
    params.agentSlug
  );
  if (!agent) {
    return {
      text: `Especialista "${params.agentSlug}" não encontrado.`,
      model: "none",
      agentName: params.agentSlug,
      agentColor: "#6B7280",
    };
  }

  // 2. Load soul + rules
  const [soul, rules] = await Promise.all([
    loadAgentDocument(params.supabase, params.workspaceId, agent.id, "soul"),
    loadAgentDocument(
      params.supabase,
      params.workspaceId,
      agent.id,
      "agent_rules"
    ),
  ]);

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt({
    soul: soul?.content || "",
    agentRules: rules?.content || "",
    accountContext: params.accountContext,
    agentSlug: params.agentSlug,
    projectContext: params.projectContext,
  });

  // 4. Select model by complexity
  const model = selectModelByComplexity(params.complexity || "normal");

  // 5. Get tools for this specialist
  const tools = getToolsForAgent(params.agentSlug);

  // 6. Build task message
  const taskMessage = params.context
    ? `${params.task}\n\nContexto adicional:\n${params.context}`
    : params.task;

  // 7. Agentic loop (non-streaming)
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: taskMessage },
  ];
  let fullText = "";
  let continueLoop = true;
  let loopCount = 0;
  const maxLoops = params.maxLoops ?? 5;

  while (continueLoop && loopCount < maxLoops) {
    loopCount++;

    const response = await anthropic.messages.create({
      model,
      max_tokens: params.maxTokens ?? 4096,
      system: systemPrompt,
      tools: tools.filter((t) => t.name !== "delegate_to_agent"),
      messages,
    });

    // Collect all tool results from this response before pushing to messages
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        // Strip choices from specialist response (Coordenador will present to user)
        const { cleanText } = extractChoices(block.text);
        fullText += cleanText;
      } else if (block.type === "tool_use") {
        // Execute the specialist's tool
        let toolResult: unknown;
        try {
          toolResult = await executeToolCall(
            block.name,
            block.input as Record<string, unknown>,
            params.accountId,
            params.workspaceId,
            params.supabase,
            agent.id
          );
        } catch (err) {
          toolResult = {
            error:
              err instanceof Error ? err.message : "Erro ao executar tool",
          };
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // If there were tool calls, push assistant + ALL tool_results as ONE user message
    if (toolResults.length > 0) {
      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }

    if (toolResults.length === 0 || response.stop_reason === "end_turn") {
      continueLoop = false;
    }
  }

  return {
    text: fullText,
    model,
    agentName: agent.name,
    agentColor: agent.avatar_color,
  };
}

// --- Main Agent Stream ---

export function createAgentStream(params: AgentStreamParams): ReadableStream {
  const {
    message,
    history,
    accountId,
    accountContext,
    workspaceId,
    coreMemories,
    supabase,
    conversationId,
    soulContent,
    agentRulesContent,
    userProfileContent,
    agentId,
    agentSlug,
    projectContext,
  } = params;

  const encoder = new TextEncoder();

  function sendEvent(
    controller: ReadableStreamDefaultController,
    data: Record<string, unknown>
  ) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const isTeamAgent = agentSlug && agentSlug !== "vortex";
        const systemPrompt = buildSystemPrompt({
          soul: soulContent || (isTeamAgent ? "" : DEFAULT_SOUL),
          agentRules:
            agentRulesContent || (isTeamAgent ? "" : DEFAULT_AGENT_RULES),
          accountContext,
          coreMemories,
          userProfile: userProfileContent,
          agentSlug,
          projectContext,
        });
        const model = selectModel(message, agentSlug);
        const tools = getToolsForAgent(agentSlug);

        // Build messages array for Anthropic API
        const messages: Anthropic.Messages.MessageParam[] = [];

        for (const msg of history.slice(-20)) {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
        messages.push({ role: "user", content: message });

        sendEvent(controller, { type: "model", model });

        if (conversationId) {
          sendEvent(controller, {
            type: "conversation_id",
            conversationId,
          });
        }

        // Agentic loop — keep calling Claude until we get a final text response
        let continueLoop = true;
        let assistantFullText = "";

        while (continueLoop) {
          const response = await anthropic.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages,
          });

          // Collect all tool results from this response before pushing to messages
          const toolResults: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: string;
          }> = [];

          for (const block of response.content) {
            if (block.type === "text") {
              const { cleanText, choices } = extractChoices(block.text);

              if (cleanText.trim()) {
                sendEvent(controller, { type: "text", content: cleanText });
                assistantFullText += cleanText;
              }

              if (choices) {
                sendEvent(controller, { type: "choices", choices });
              }
            } else if (block.type === "tool_use") {
              // --- Special handling: delegate_to_agent ---
              if (block.name === "delegate_to_agent") {
                const delegateInput = block.input as {
                  agent_slug: string;
                  task: string;
                  context?: string;
                  complexity?: string;
                };

                sendEvent(controller, {
                  type: "tool_use",
                  name: block.name,
                  input: delegateInput,
                });

                // Notify UI: specialist is starting
                sendEvent(controller, {
                  type: "specialist_start",
                  agent_slug: delegateInput.agent_slug,
                });

                let specialistResult: SpecialistResult;

                if (workspaceId && supabase) {
                  specialistResult = await runSpecialist({
                    agentSlug: delegateInput.agent_slug,
                    task: delegateInput.task,
                    context: delegateInput.context,
                    complexity: delegateInput.complexity,
                    accountId,
                    accountContext,
                    workspaceId,
                    supabase,
                    projectContext,
                  });
                } else {
                  specialistResult = {
                    text: "Workspace não configurado. Não foi possível executar o especialista.",
                    model: "none",
                    agentName: delegateInput.agent_slug,
                    agentColor: "#6B7280",
                  };
                }

                // Notify UI: specialist response
                sendEvent(controller, {
                  type: "specialist_response",
                  agent_name: specialistResult.agentName,
                  agent_color: specialistResult.agentColor,
                  agent_slug: delegateInput.agent_slug,
                  content: specialistResult.text,
                  model: specialistResult.model,
                });

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    specialist: specialistResult.agentName,
                    response: specialistResult.text,
                  }),
                });
              } else {
                // --- Standard tool handling ---
                sendEvent(controller, {
                  type: "tool_use",
                  name: block.name,
                  input: block.input,
                });

                let toolResult: unknown;
                try {
                  toolResult = await executeToolCall(
                    block.name,
                    block.input as Record<string, unknown>,
                    accountId,
                    workspaceId,
                    supabase,
                    agentId
                  );
                } catch (err) {
                  toolResult = {
                    error:
                      err instanceof Error
                        ? err.message
                        : "Erro ao executar tool",
                  };
                }

                sendEvent(controller, {
                  type: "tool_result",
                  name: block.name,
                  result: toolResult,
                });

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify(toolResult),
                });
              }
            }
          }

          // If there were tool calls, push assistant + ALL tool_results as ONE user message
          if (toolResults.length > 0) {
            messages.push({
              role: "assistant",
              content: response.content,
            });
            messages.push({
              role: "user",
              content: toolResults,
            });
          }

          // If no tool was used, we're done
          if (toolResults.length === 0) {
            continueLoop = false;
          }

          // Safety: stop after end_turn
          if (response.stop_reason === "end_turn") {
            continueLoop = false;
          }
        }

        // Persist assistant message to DB
        if (conversationId && supabase && assistantFullText) {
          try {
            await saveMessage(
              supabase,
              conversationId,
              "assistant",
              assistantFullText,
              { model }
            );
            await updateConversationTimestamp(supabase, conversationId);
          } catch {
            // Don't fail the stream if persistence fails
          }
        }

        // Auto-extract facts (only for Vortex agent, not team agents)
        if (workspaceId && supabase && assistantFullText && !isTeamAgent) {
          try {
            await extractAndSaveFacts(
              supabase,
              workspaceId,
              accountId,
              message,
              assistantFullText,
              coreMemories || ""
            );
          } catch {
            // Silently ignore extraction failures
          }
        }

        sendEvent(controller, { type: "done" });
        controller.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Erro desconhecido";
        sendEvent(controller, { type: "error", message: errorMessage });
        controller.close();
      }
    },
  });
}
