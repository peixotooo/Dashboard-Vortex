// Harness do vendedor virtual — loop agentic de tool-calling.
//
// Um turno = mensagem do cliente → (LLM ↔ ferramentas até 4 iterações) →
// resposta final sanitizada + cards de produto. Sem streaming de propósito:
// a resposta completa passa pelos guardrails ANTES de chegar ao cliente.

import type Anthropic from "@anthropic-ai/sdk";
import { callLLM } from "@/lib/agent/llm-provider";
import { getProductDetails } from "./catalog";
import {
  extractProductMarkers,
  sanitizeReply,
} from "./guardrails";
import { buildSystemPrompt } from "./prompt";
import { ASSISTANT_TOOLS, executeAssistantTool, type ToolContext } from "./tools";
import type {
  AssistantChatResult,
  AssistantHistoryMessage,
  AssistantProductCard,
  AssistantSettings,
} from "./types";

const MAX_TOOL_ITERATIONS = 4;
const MAX_REPLY_TOKENS = 700;
const HISTORY_WINDOW = 12;

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

const FALLBACK_REPLY =
  "Não consegui processar sua pergunta agora. Pode tentar de novo em instantes?";

export async function runAssistantTurn(opts: {
  workspaceId: string;
  settings: AssistantSettings;
  storeHost: string;
  history: AssistantHistoryMessage[];
  userMessage: string;
  currentProductId: string | null;
  customerName?: string | null;
}): Promise<AssistantChatResult> {
  const { workspaceId, settings, storeHost, history, userMessage, currentProductId, customerName } = opts;

  // Contexto do produto da página — a maioria das perguntas é sobre ele
  let currentProduct = null;
  if (currentProductId) {
    try {
      currentProduct = await getProductDetails(workspaceId, currentProductId);
    } catch {
      // segue sem contexto de produto
    }
  }

  const system = buildSystemPrompt({ settings, storeHost, currentProduct, customerName });

  // Histórico replayado: só texto user/assistant persistido pelo servidor.
  // Tool calls de turnos anteriores NÃO são replayados (contexto se regenera).
  const messages: Anthropic.Messages.MessageParam[] = history
    .slice(-HISTORY_WINDOW)
    .map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: "user", content: userMessage });

  const toolCtx: ToolContext = {
    workspaceId,
    settings,
    pageType: currentProductId ? "product" : "home",
    seenProducts: new Map(),
  };
  const toolLog: AssistantChatResult["toolLog"] = [];

  const model = settings.model || process.env.ASSISTANT_MODEL || DEFAULT_MODEL;

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callLLM({
      provider: "openrouter",
      model,
      maxTokens: MAX_REPLY_TOKENS,
      system,
      tools: ASSISTANT_TOOLS,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    const texts = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      finalText = texts;
      break;
    }

    // Executa as tools e devolve os resultados ao modelo
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const output = await executeAssistantTool(toolCtx, tu.name, tu.input);
      toolLog.push({
        name: tu.name,
        input: tu.input,
        ok: !output.includes('"erro"'),
      });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: output,
      });
    }
    messages.push({ role: "user", content: results });

    // Última iteração com tool_use pendente → guarda o texto que houver
    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalText = texts;
    }
  }

  if (!finalText) {
    return { reply: FALLBACK_REPLY, products: [], toolLog };
  }

  // Marcadores [[produto:ID]] → cards (só de produtos que as tools realmente
  // retornaram neste turno ou que existem no catálogo — nada inventado)
  const { cleanText, productIds } = extractProductMarkers(finalText);
  const products: AssistantProductCard[] = [];
  for (const id of productIds) {
    const seen = toolCtx.seenProducts.get(id);
    if (seen) {
      products.push(seen);
      continue;
    }
    // Produto da página atual também pode virar card
    if (currentProduct && currentProduct.id === id) {
      products.push({
        id: currentProduct.id,
        name: currentProduct.name,
        url: currentProduct.url,
        image_url: currentProduct.image_url,
        price: currentProduct.price,
        sale_price: currentProduct.sale_price,
        available: currentProduct.available,
      });
    }
  }

  return {
    reply: sanitizeReply(cleanText) || FALLBACK_REPLY,
    products,
    toolLog,
  };
}
