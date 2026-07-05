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
  extractWhatsappMarker,
  sanitizeReply,
} from "./guardrails";
import { buildSystemPrompt } from "./prompt";
import { ASSISTANT_TOOLS, executeAssistantTool, type ToolContext } from "./tools";
import type { ActiveKnowledge } from "./knowledge";
import type {
  AssistantBlock,
  AssistantChatResult,
  AssistantHistoryMessage,
  AssistantProductCard,
  AssistantProductDetails,
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
  /** "global" = página /chat (Chat Commerce v2). Default "pdp" (widget). */
  surface?: "pdp" | "global";
}): Promise<AssistantChatResult> {
  const { workspaceId, settings, storeHost, history, userMessage, currentProductId, customerName } = opts;
  const surface = opts.surface === "global" ? "global" : "pdp";

  // Contexto do produto da página — a maioria das perguntas é sobre ele
  let currentProduct = null;
  if (currentProductId) {
    try {
      currentProduct = await getProductDetails(workspaceId, currentProductId);
    } catch {
      // segue sem contexto de produto
    }
  }

  const system = buildSystemPrompt({ settings, storeHost, currentProduct, customerName, surface });

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
    surface,
  };

  // No PDP (v1) as tools de vitrine/avaliações NÃO são oferecidas — elas emitem
  // marcadores ricos ([[vitrine]]/[[avaliacoes]]) que o widget v1 não sabe
  // renderizar. Mantém o v1 idêntico ao de antes do Chat Commerce v2.
  const tools =
    surface === "global"
      ? ASSISTANT_TOOLS
      : ASSISTANT_TOOLS.filter((t) => t.name !== "vitrine" && t.name !== "avaliacoes");
  const toolLog: AssistantChatResult["toolLog"] = [];

  const model = settings.model || process.env.ASSISTANT_MODEL || DEFAULT_MODEL;

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callLLM({
      provider: "openrouter",
      model,
      maxTokens: MAX_REPLY_TOKENS,
      system,
      tools,
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
    return { reply: FALLBACK_REPLY, products: [], showWhatsapp: false, toolLog };
  }

  // Marcador [[whatsapp]] → botão de atendimento no widget
  const { cleanText: textAfterWa, showWhatsapp } = extractWhatsappMarker(finalText);

  // Marcadores [[produto:ID]] → cards (só de produtos que as tools realmente
  // retornaram neste turno ou que existem no catálogo — nada inventado)
  const { cleanText, productIds } = extractProductMarkers(textAfterWa);
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

  // Chat Commerce v2: blocos ordenados (texto + vitrine + reviews + benefícios
  // + promo + cart_add + whatsapp). v1 ignora `blocks`; usa reply/products.
  const blocks = assembleBlocks(finalText, toolCtx, currentProduct);

  // Defesa: nenhum marcador rico do v2 pode sobrar no texto do reply. O widget
  // v1 não os renderiza; o cliente veria "[[promo]]" literal. Remove qualquer
  // resíduo (o produto/whatsapp já foram extraídos acima).
  const replyText = stripRichMarkers(cleanText);

  return {
    reply: sanitizeReply(replyText) || FALLBACK_REPLY,
    products,
    showWhatsapp,
    toolLog,
    blocks,
  };
}

// ---- Montagem de blocos ricos (Chat Commerce v2) ----

// Tokeniza o texto final por TODOS os marcadores, preservando a ordem.
// Ordem importa: o modelo intercala prosa com [[vitrine]] / [[avaliacoes]] /
// [[produto:ID]] / [[carrinho:ID:tam]] / [[beneficios]] / [[promo]] / [[whatsapp]].
const MARKER_RE =
  /\[\[\s*(produto\s*:\s*[\w-]{1,40}|carrinho\s*:\s*[\w-]{1,40}(?:\s*:\s*[\wÀ-ÿ.\/ ]{1,12})?|vitrine|avaliacoes|beneficios|promo|whatsapp)\s*\]\]/gi;

function fmtBRL(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

// Remove marcadores ricos do v2 que possam ter sobrado no texto do reply v1.
function stripRichMarkers(text: string): string {
  return text
    .replace(/\[\[\s*(vitrine|avaliacoes|beneficios|promo|carrinho\s*:[^\]]*)\s*\]\]/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function benefitsBlockData(k: ActiveKnowledge | undefined): AssistantBlock | null {
  if (!k) return null;
  const items = Array.isArray(k.benefits) ? k.benefits.filter(Boolean).slice(0, 8) : [];
  const cashbackPercent = k.cashback?.percent ? Number(k.cashback.percent) : 0;
  if (items.length === 0 && cashbackPercent === 0) return null;
  return { type: "benefits", data: { items, cashbackPercent } };
}

function promoBlockData(k: ActiveKnowledge | undefined): AssistantBlock | null {
  if (!k) return null;
  const lines: string[] = [];
  for (const m of k.topbarMessages || []) {
    const s = String(m || "").trim();
    if (s) lines.push(s);
  }
  // Só cupom apresentável: geral, ou específico de produto com nome resolvido
  // (mesma regra do formatActiveKnowledge — não oferecer desconto que não aplica).
  for (const c of k.coupons || []) {
    if (!c?.code || !c.discount) continue;
    if (c.productId && !c.productName) continue;
    const scope = c.productName ? ` (só ${c.productName})` : "";
    lines.push(`Cupom ${c.code}: ${c.discount} de desconto${scope}`);
  }
  if (k.giftBar?.active) {
    for (const step of k.giftBar.steps || []) {
      if (step?.threshold && step?.gift) {
        lines.push(`Gaste ${fmtBRL(Number(step.threshold))} e ganhe ${step.gift}`);
      }
    }
  }
  if (k.cashback?.percent) {
    lines.push(`${k.cashback.percent}% de cashback (liberado ~${k.cashback.depositDelayDays} dias após a confirmação do pagamento)`);
  }
  const unique = [...new Set(lines)].slice(0, 6);
  if (unique.length === 0) return null;
  return { type: "promo", data: { lines: unique } };
}

function assembleBlocks(
  finalText: string,
  ctx: ToolContext,
  currentProduct: AssistantProductDetails | null
): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  let pendingCards: AssistantProductCard[] = [];

  const flushCards = () => {
    if (pendingCards.length === 0) return;
    blocks.push({
      type: "products",
      layout: pendingCards.length >= 3 ? "carousel" : "cards",
      products: pendingCards,
    });
    pendingCards = [];
  };

  const cardFor = (id: string): AssistantProductCard | null => {
    const seen = ctx.seenProducts.get(id);
    if (seen) return seen;
    if (currentProduct && currentProduct.id === id) {
      return {
        id: currentProduct.id,
        name: currentProduct.name,
        url: currentProduct.url,
        image_url: currentProduct.image_url,
        price: currentProduct.price,
        sale_price: currentProduct.sale_price,
        available: currentProduct.available,
      };
    }
    return null;
  };

  const pushText = (raw: string) => {
    const clean = sanitizeReply(raw).trim();
    if (clean) {
      flushCards();
      blocks.push({ type: "text", text: clean });
    }
  };

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(finalText)) !== null) {
    // Texto antes do marcador
    pushText(finalText.slice(lastIndex, m.index));
    lastIndex = MARKER_RE.lastIndex;

    const token = m[1].toLowerCase().replace(/\s+/g, "");

    if (token.startsWith("produto:")) {
      const id = token.slice("produto:".length);
      const card = cardFor(id);
      if (card) pendingCards.push(card);
    } else if (token.startsWith("carrinho:")) {
      // [[carrinho:ID]] ou [[carrinho:ID:tam]]. NÃO exige que o produto tenha
      // sido buscado neste turno (num "sim" de confirmação ele não é) — o
      // cliente resolve o ID no cart-resolve, que valida de verdade. Só checa
      // que o ID tem forma de id de produto (evita marcador com nome/lixo).
      const rest = m[1].split(":").slice(1);
      const id = String(rest[0] || "").trim();
      const size = rest[1] ? String(rest[1]).trim() : null;
      if (id && /^[\w-]{1,40}$/.test(id)) {
        flushCards();
        blocks.push({ type: "cart_add", data: { productId: id, size } });
      }
    } else if (token === "vitrine") {
      flushCards();
      if (ctx.seenVitrine && ctx.seenVitrine.products.length > 0) {
        blocks.push({
          type: "products",
          layout: "carousel",
          title: ctx.seenVitrine.title,
          products: ctx.seenVitrine.products,
        });
      }
    } else if (token === "avaliacoes") {
      flushCards();
      if (ctx.seenReviews) blocks.push({ type: "reviews", data: ctx.seenReviews });
    } else if (token === "beneficios") {
      const b = benefitsBlockData(ctx.seenKnowledge);
      if (b) {
        flushCards();
        blocks.push(b);
      }
    } else if (token === "promo") {
      const p = promoBlockData(ctx.seenKnowledge);
      if (p) {
        flushCards();
        blocks.push(p);
      }
    } else if (token === "whatsapp") {
      flushCards();
      blocks.push({ type: "whatsapp" });
    }
  }
  // Texto após o último marcador
  pushText(finalText.slice(lastIndex));
  flushCards();

  return blocks;
}
