import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type AccountContext } from "./system-prompt";
import { DEFAULT_SOUL, DEFAULT_AGENT_RULES } from "./default-documents";
import { AGENT_TOOLS } from "./tool-definitions";
import { executeToolCall } from "./tool-executor";
import { saveMessage, updateConversationTimestamp } from "./memory";
import { extractAndSaveFacts } from "./fact-extraction";
import type { SupabaseClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

function selectModel(message: string): string {
  const complexPatterns =
    /cri(a|e|ar)|analis|otimiz|estratégia|sugest|configur|segmenta|público/i;
  return complexPatterns.test(message)
    ? "claude-sonnet-4-5-20250929"
    : "claude-haiku-4-5-20251001";
}

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
}

interface Choice {
  label: string;
  value: string;
}

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
        const systemPrompt = buildSystemPrompt({
          soul: soulContent || DEFAULT_SOUL,
          agentRules: agentRulesContent || DEFAULT_AGENT_RULES,
          accountContext,
          coreMemories,
          userProfile: userProfileContent,
        });
        const model = selectModel(message);

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
            tools: AGENT_TOOLS,
            messages,
          });

          // Process response content blocks
          let hasToolUse = false;

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
              hasToolUse = true;

              sendEvent(controller, {
                type: "tool_use",
                name: block.name,
                input: block.input,
              });

              // Execute the tool
              let toolResult: unknown;
              try {
                toolResult = await executeToolCall(
                  block.name,
                  block.input as Record<string, unknown>,
                  accountId,
                  workspaceId,
                  supabase
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

              // Add assistant message + tool result to continue the conversation
              messages.push({
                role: "assistant",
                content: response.content,
              });
              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify(toolResult),
                  },
                ],
              });
            }
          }

          // If no tool was used, we're done
          if (!hasToolUse) {
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

        // Auto-extract facts from the conversation (Haiku, ~300-500ms)
        // User already has the full response, so this latency is acceptable
        if (workspaceId && supabase && assistantFullText) {
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
