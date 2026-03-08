/**
 * LLM Provider Abstraction Layer
 *
 * Routes between Anthropic (direct) and OpenRouter (OpenAI-compatible)
 * based on workspace configuration. Normalizes responses to Anthropic
 * content-block format so the rest of the codebase stays unchanged.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// --- Provider Config ---

export interface ProviderConfig {
  provider: "anthropic" | "openrouter";
  models?: {
    deep?: string;
    normal?: string;
    basic?: string;
    coordinator?: string;
  };
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "anthropic",
};

// --- Default model mapping for OpenRouter ---

const OPENROUTER_MODEL_DEFAULTS: Record<string, string> = {
  deep: "anthropic/claude-sonnet-4.6",
  normal: "deepseek/deepseek-chat",
  basic: "google/gemini-2.0-flash",
  coordinator: "anthropic/claude-haiku-4.5",
};

// --- Clients (lazy singletons) ---

let _anthropic: Anthropic | null = null;
let _openrouter: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
  }
  return _anthropic;
}

function getOpenRouterClient(): OpenAI {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || "",
      defaultHeaders: {
        "HTTP-Referer": "https://dashboard-vortex.vercel.app",
        "X-OpenRouter-Title": "Vortex Dashboard",
      },
    });
  }
  return _openrouter;
}

// --- Model Resolution ---

/**
 * Resolves model name based on provider and complexity tier.
 * For Anthropic: returns the Anthropic model ID as-is.
 * For OpenRouter: maps tier to configured (or default) OpenRouter model.
 */
export function resolveModel(
  config: ProviderConfig,
  tier: string,
  anthropicModel: string
): string {
  if (config.provider === "anthropic") return anthropicModel;
  const models: Record<string, string> = { ...OPENROUTER_MODEL_DEFAULTS, ...config.models };
  return models[tier] || models.normal;
}

// --- Normalized types (Anthropic-like) ---

export interface LLMParams {
  provider: "anthropic" | "openrouter";
  model: string;
  maxTokens: number;
  system: string;
  tools: Anthropic.Messages.Tool[];
  messages: Anthropic.Messages.MessageParam[];
}

export interface LLMResponse {
  content: Anthropic.Messages.ContentBlock[];
  stop_reason: string;
}

// --- Main entry point ---

export async function callLLM(params: LLMParams): Promise<LLMResponse> {
  if (params.provider === "anthropic") {
    return callAnthropic(params);
  }
  return callOpenRouter(params);
}

// --- Anthropic (direct) ---

async function callAnthropic(params: LLMParams): Promise<LLMResponse> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    tools: params.tools,
    messages: params.messages,
  });
  return {
    content: response.content,
    stop_reason: response.stop_reason || "end_turn",
  };
}

// --- OpenRouter (OpenAI-compatible) ---

async function callOpenRouter(params: LLMParams): Promise<LLMResponse> {
  const client = getOpenRouterClient();

  // Convert tools: Anthropic → OpenAI format
  const openaiTools: OpenAI.ChatCompletionTool[] = params.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));

  // Convert messages: Anthropic → OpenAI format
  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system" as const, content: params.system },
  ];

  for (const msg of params.messages) {
    openaiMessages.push(...convertMessage(msg));
  }

  const response = await client.chat.completions.create({
    model: params.model,
    max_tokens: params.maxTokens,
    messages: openaiMessages,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    tool_choice: openaiTools.length > 0 ? "auto" : undefined,
  });

  // Convert response: OpenAI → Anthropic-like format
  return convertResponse(response);
}

// --- Message Conversion (Anthropic → OpenAI) ---

function convertMessage(
  msg: Anthropic.Messages.MessageParam
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  if (msg.role === "assistant") {
    // Assistant message can have text + tool_use blocks
    if (typeof msg.content === "string") {
      result.push({ role: "assistant", content: msg.content });
    } else if (Array.isArray(msg.content)) {
      let textContent = "";
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: textContent || null,
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      result.push(assistantMsg);
    }
  } else if (msg.role === "user") {
    if (typeof msg.content === "string") {
      result.push({ role: "user", content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Check if this is tool results or regular content
      const hasToolResults = msg.content.some(
        (b) =>
          typeof b === "object" &&
          "type" in b &&
          b.type === "tool_result"
      );

      if (hasToolResults) {
        // Convert tool_result blocks → individual tool messages
        for (const block of msg.content) {
          if (
            typeof block === "object" &&
            "type" in block &&
            block.type === "tool_result"
          ) {
            const toolResult = block as {
              type: "tool_result";
              tool_use_id: string;
              content: string;
            };
            result.push({
              role: "tool",
              tool_call_id: toolResult.tool_use_id,
              content:
                typeof toolResult.content === "string"
                  ? toolResult.content
                  : JSON.stringify(toolResult.content),
            });
          }
        }
      } else {
        // Regular multimodal content (text + images)
        const parts: OpenAI.ChatCompletionContentPart[] = [];
        for (const block of msg.content) {
          if (typeof block === "object" && "type" in block) {
            if (block.type === "text") {
              parts.push({
                type: "text",
                text: (block as { type: "text"; text: string }).text,
              });
            } else if (block.type === "image") {
              // Anthropic image → OpenAI image_url
              const imgBlock = block as {
                type: "image";
                source: { type: string; url?: string; data?: string; media_type?: string };
              };
              if (imgBlock.source.type === "url" && imgBlock.source.url) {
                parts.push({
                  type: "image_url",
                  image_url: { url: imgBlock.source.url },
                });
              } else if (
                imgBlock.source.type === "base64" &&
                imgBlock.source.data
              ) {
                parts.push({
                  type: "image_url",
                  image_url: {
                    url: `data:${imgBlock.source.media_type || "image/png"};base64,${imgBlock.source.data}`,
                  },
                });
              }
            }
          }
        }
        if (parts.length > 0) {
          result.push({ role: "user", content: parts });
        }
      }
    }
  }

  return result;
}

// --- Response Conversion (OpenAI → Anthropic-like) ---

function convertResponse(
  response: OpenAI.ChatCompletion
): LLMResponse {
  const choice = response.choices[0];
  if (!choice) {
    return { content: [], stop_reason: "end_turn" };
  }

  const contentBlocks: Anthropic.Messages.ContentBlock[] = [];

  // Text content
  if (choice.message.content) {
    contentBlocks.push({
      type: "text",
      text: choice.message.content,
      citations: null,
    } as Anthropic.Messages.TextBlock);
  }

  // Tool calls → tool_use blocks
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      let parsedInput: unknown = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch {
        parsedInput = { raw: tc.function.arguments };
      }

      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      } as Anthropic.Messages.ToolUseBlock);
    }
  }

  // Map finish_reason → stop_reason
  let stopReason = "end_turn";
  if (choice.finish_reason === "tool_calls") {
    stopReason = "tool_use";
  } else if (choice.finish_reason === "length") {
    stopReason = "max_tokens";
  } else if (choice.finish_reason === "content_filter") {
    stopReason = "end_turn";
  }

  return {
    content: contentBlocks,
    stop_reason: stopReason,
  };
}
