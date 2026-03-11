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
  createTask,
} from "./memory";
import { extractAndSaveFacts } from "./fact-extraction";
import {
  callLLM,
  resolveModel,
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfig,
} from "./llm-provider";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  imageUrls?: string[];
  imageAttachments?: ImageAttachment[];
  providerConfig?: ProviderConfig;
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

export interface ImageAttachment {
  filename: string;
  image_hash?: string;
  video_id?: string;
  image_url?: string;
}

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
  imageAttachments?: ImageAttachment[];
  providerConfig?: ProviderConfig;
  timeBudgetMs?: number;
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
  const complexity = params.complexity || "normal";
  const model = selectModelByComplexity(complexity);
  const providerConfig = params.providerConfig || DEFAULT_PROVIDER_CONFIG;

  // 5. Get tools for this specialist
  const tools = getToolsForAgent(params.agentSlug);

  // 6. Build task message (inject image attachments context)
  let taskMessage = params.context
    ? `${params.task}\n\nContexto adicional:\n${params.context}`
    : params.task;

  if (params.imageAttachments && params.imageAttachments.length > 0) {
    const imgList = params.imageAttachments
      .map((a) => `- ${a.filename} (${a.video_id ? `video_id: "${a.video_id}"` : `image_hash: "${a.image_hash}"`})`)
      .join("\n");
    taskMessage += `\n\n[MÍDIAS ANEXADAS — já enviadas para a conta Meta]\n${imgList}\n\nIMPORTANTE: Use EXATAMENTE estes image_hashes/video_ids. NAO chame list_media_gallery — voce JA TEM as mídias necessárias acima.`;
  }

  // 7. Agentic loop (non-streaming)
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: taskMessage },
  ];
  let fullText = "";
  let continueLoop = true;
  let loopCount = 0;
  const maxLoops = params.maxLoops ?? 12;
  const specialistStartTime = Date.now();

  while (continueLoop && loopCount < maxLoops) {
    // Time budget check — stop before exceeding the streaming timeout
    if (params.timeBudgetMs && (Date.now() - specialistStartTime) > params.timeBudgetMs) {
      fullText += "\n\n---\n*Limite de tempo atingido para este especialista. Trabalho parcial entregue.*";
      break;
    }
    loopCount++;

    const response = await callLLM({
      provider: providerConfig.provider,
      model: resolveModel(providerConfig, complexity, model),
      maxTokens: params.maxTokens ?? 4096,
      system: systemPrompt,
      tools: tools.filter((t) => t.name !== "delegate_to_agent"),
      messages,
      allowedModels: providerConfig.allowedModels,
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

    if (toolResults.length === 0) {
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
    imageUrls,
    imageAttachments,
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
      // Heartbeat to keep connection alive during long operations (Vercel proxy timeout)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

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
        const providerConfig = params.providerConfig || DEFAULT_PROVIDER_CONFIG;
        // Determine tier for OpenRouter model resolution
        const tier = agentSlug === "coordenador" ? "coordinator" : (
          model === MODEL_TIERS.deep ? "deep" :
          model === MODEL_TIERS.basic ? "basic" : "normal"
        );
        const tools = getToolsForAgent(agentSlug);

        // Build messages array for Anthropic API
        const messages: Anthropic.Messages.MessageParam[] = [];

        for (const msg of history.slice(-20)) {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
        // Build user message — multimodal if images are attached
        if (imageUrls && imageUrls.length > 0) {
          const contentBlocks: Anthropic.Messages.ContentBlockParam[] = imageUrls.map((url: string) => ({
            type: "image" as const,
            source: {
              type: "url" as const,
              url,
            },
          }));
          contentBlocks.push({ type: "text" as const, text: message });
          messages.push({ role: "user", content: contentBlocks });
        } else {
          messages.push({ role: "user", content: message });
        }

        const resolvedModel = resolveModel(providerConfig, tier, model);
        sendEvent(controller, {
          type: "model",
          model: resolvedModel,
          provider: providerConfig.provider,
        });

        if (conversationId) {
          sendEvent(controller, {
            type: "conversation_id",
            conversationId,
          });
        }

        // Agentic loop — keep calling Claude until we get a final text response
        let continueLoop = true;
        let assistantFullText = "";
        let loopCount = 0;
        const MAX_LOOPS = 15;
        const startTime = Date.now();
        const TIMEOUT_MS = 250_000; // 250s graceful limit (Vercel max is 300s)

        while (continueLoop && loopCount < MAX_LOOPS) {
          // Graceful timeout check
          if (Date.now() - startTime > TIMEOUT_MS) {
            sendEvent(controller, {
              type: "text",
              content: "\n\n---\n*Tempo limite atingido. Envie outra mensagem para continuar.*",
            });
            break;
          }
          loopCount++;
          const response = await callLLM({
            provider: providerConfig.provider,
            model: resolveModel(providerConfig, tier, model),
            maxTokens: 4096,
            system: systemPrompt,
            tools,
            messages,
            allowedModels: providerConfig.allowedModels,
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
                  async?: boolean;
                };

                sendEvent(controller, {
                  type: "tool_use",
                  name: block.name,
                  input: delegateInput,
                });

                // --- Async mode: create task for background processing ---
                if (delegateInput.async && workspaceId && supabase) {
                  const SLUG_TO_TASK_TYPE: Record<string, string> = {
                    copywriting: "copy", "copy-editing": "copy", "email-sequence": "copy", "cold-email": "copy",
                    "seo-audit": "seo", "ai-seo": "seo", "programmatic-seo": "seo", "schema-markup": "seo", "site-architecture": "seo", "content-strategy": "seo",
                    "social-content": "social_calendar",
                    "paid-ads": "campaign", "ad-creative": "campaign",
                    "page-cro": "cro", "form-cro": "cro", "signup-flow-cro": "cro", "onboarding-cro": "cro", "popup-cro": "cro", "paywall-upgrade-cro": "cro", "ab-test-setup": "cro",
                    "launch-strategy": "strategy", "pricing-strategy": "strategy", "marketing-psychology": "strategy", "marketing-ideas": "strategy", "free-tool-strategy": "strategy",
                    "churn-prevention": "revenue", "referral-program": "revenue", revops: "revenue",
                    "sales-enablement": "general", "competitor-alternatives": "general", "analytics-tracking": "general",
                  };

                  const specialist = await getAgentBySlug(supabase, workspaceId, delegateInput.agent_slug);
                  const taskType = SLUG_TO_TASK_TYPE[delegateInput.agent_slug] || "general";
                  const priority = delegateInput.complexity === "deep" ? "high" : "medium";

                  const taskDescription = delegateInput.context
                    ? `${delegateInput.task}\n\nContexto adicional:\n${delegateInput.context}`
                    : delegateInput.task;

                  const task = await createTask(supabase, workspaceId, {
                    title: delegateInput.task.slice(0, 120),
                    description: taskDescription,
                    agent_id: specialist?.id,
                    priority,
                    task_type: taskType,
                    conversation_id: conversationId,
                  });

                  sendEvent(controller, {
                    type: "task_queued",
                    task_id: task.id,
                    task_title: task.title,
                    agent_slug: delegateInput.agent_slug,
                    agent_name: specialist?.name || delegateInput.agent_slug,
                  });

                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify({
                      queued: true,
                      task_id: task.id,
                      task_title: task.title,
                      message: `Tarefa criada e atribuida a ${specialist?.name || delegateInput.agent_slug}. Sera processada automaticamente em background. O resultado ficara disponivel na pagina de entregas.`,
                    }),
                  });
                } else {
                  // --- Sync mode: run specialist inline ---
                  // Notify UI: specialist is starting
                  sendEvent(controller, {
                    type: "specialist_start",
                    agent_slug: delegateInput.agent_slug,
                  });

                  let specialistResult: SpecialistResult;

                  if (workspaceId && supabase) {
                    const remainingMs = TIMEOUT_MS - (Date.now() - startTime) - 30_000;
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
                      imageAttachments,
                      maxLoops: delegateInput.complexity === "deep" ? 20 : 12,
                      maxTokens: delegateInput.complexity === "deep" ? 8192 : 4096,
                      providerConfig,
                      timeBudgetMs: remainingMs > 30_000 ? remainingMs : undefined,
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
                }
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

          // Exit only when Claude made no tool calls (finished working)
          // If tools were called, always continue so Claude sees the results
          if (toolResults.length === 0) {
            continueLoop = false;
          }
        }

        // Notify if loop limit was reached
        if (loopCount >= MAX_LOOPS) {
          sendEvent(controller, {
            type: "text",
            content: "\n\n---\n*Limite de operacoes atingido. Envie outra mensagem para continuar.*",
          });
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
      } finally {
        clearInterval(heartbeat);
      }
    },
  });
}
