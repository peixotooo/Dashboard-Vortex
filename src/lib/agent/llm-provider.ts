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
  allowedModels?: string[];
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "anthropic",
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
 * Resolves model name based on provider.
 * For Anthropic: returns the Anthropic model ID as-is.
 * For OpenRouter: returns "openrouter/auto" (auto router selects best model).
 */
export function resolveModel(
  config: ProviderConfig,
  _tier: string,
  anthropicModel: string
): string {
  if (config.provider === "anthropic") return anthropicModel;
  return "openrouter/auto";
}

// --- Normalized types (Anthropic-like) ---

export interface LLMParams {
  provider: "anthropic" | "openrouter";
  model: string;
  maxTokens: number;
  system: string;
  tools: Anthropic.Messages.Tool[];
  messages: Anthropic.Messages.MessageParam[];
  allowedModels?: string[];
}

export interface LLMResponse {
  content: Anthropic.Messages.ContentBlock[];
  stop_reason: string;
}

// --- Main entry point ---

export async function callLLM(params: LLMParams): Promise<LLMResponse> {
  // Validate that the selected provider has an API key
  if (params.provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      // Fallback to Anthropic if available
      if (process.env.ANTHROPIC_API_KEY) {
        console.warn("[llm-provider] OPENROUTER_API_KEY not set, falling back to Anthropic");
        return callAnthropic(params);
      }
      throw new Error("OPENROUTER_API_KEY não configurada. Adicione a env var e faça redeploy.");
    }
    return callOpenRouter(params);
  }

  // Anthropic provider
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fallback to OpenRouter if available
    if (process.env.OPENROUTER_API_KEY) {
      console.warn("[llm-provider] ANTHROPIC_API_KEY not set, falling back to OpenRouter");
      return callOpenRouter(params);
    }
    throw new Error("ANTHROPIC_API_KEY não configurada.");
  }
  return callAnthropic(params);
}

// --- Anthropic (direct) ---

async function imageUrlToBase64(url: string): Promise<{ data: string; media_type: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image from URL: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mediaType = res.headers.get("content-type") || "image/png";
  return {
    data: buffer.toString("base64"),
    media_type: mediaType,
  };
}

async function callAnthropic(params: LLMParams): Promise<LLMResponse> {
  const client = getAnthropicClient();

  // Convert image URLs to base64 for Anthropic direct API
  const processedMessages = await Promise.all(
    params.messages.map(async (msg) => {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const newContent = await Promise.all(
          msg.content.map(async (block) => {
            if (typeof block === "object" && "type" in block && block.type === "image") {
                const imgBlock = block as any;
                if (imgBlock.source?.type === "url" && imgBlock.source?.url) {
                    try {
                        const { data, media_type } = await imageUrlToBase64(imgBlock.source.url);
                        return {
                            type: "image" as const,
                            source: {
                                type: "base64" as const,
                                media_type: media_type as any,
                                data,
                            },
                        };
                    } catch (err) {
                        console.error("[llm-provider] Error converting image to base64:", err);
                        // Fallback: return as text if image fetch fails to avoid crashing the whole request
                        return { type: "text" as const, text: `[Erro ao carregar imagem: ${imgBlock.source.url}]` };
                    }
                }
            }
            return block;
          })
        );
        return { ...msg, content: newContent };
      }
      return msg;
    })
  );

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    tools: params.tools,
    messages: processedMessages as any,
  });

  return {
    content: response.content,
    stop_reason: response.stop_reason || "end_turn",
  };
}

// --- OpenRouter (OpenAI-compatible) ---

async function callOpenRouter(params: LLMParams): Promise<LLMResponse> {
  const client = getOpenRouterClient();

  // Pre-process: convert image URLs to base64 data URIs (OpenRouter models can't always fetch external URLs)
  const processedMessages = await Promise.all(
    params.messages.map(async (msg) => {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const newContent = await Promise.all(
          msg.content.map(async (block) => {
            if (typeof block === "object" && "type" in block && block.type === "image") {
              const imgBlock = block as any;
              if (imgBlock.source?.type === "url" && imgBlock.source?.url) {
                try {
                  const { data, media_type } = await imageUrlToBase64(imgBlock.source.url);
                  return {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type,
                      data,
                    },
                  };
                } catch (err) {
                  console.error("[llm-provider] OpenRouter: error converting image to base64:", err);
                  return { type: "text" as const, text: `[Erro ao carregar imagem: ${imgBlock.source.url}]` };
                }
              }
            }
            return block;
          })
        );
        return { ...msg, content: newContent };
      }
      return msg;
    })
  );

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

  for (const msg of processedMessages) {
    openaiMessages.push(...convertMessage(msg as Anthropic.Messages.MessageParam));
  }

  // Build request — include plugins for auto router if allowed_models configured
  const createParams: OpenAI.ChatCompletionCreateParamsNonStreaming & { plugins?: unknown[] } = {
    model: params.model,
    max_tokens: params.maxTokens,
    messages: openaiMessages,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    tool_choice: openaiTools.length > 0 ? "auto" : undefined,
  };

  if (params.allowedModels && params.allowedModels.length > 0) {
    createParams.plugins = [
      { id: "auto-router", allowed_models: params.allowedModels },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await client.chat.completions.create(createParams as any) as OpenAI.ChatCompletion;

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
