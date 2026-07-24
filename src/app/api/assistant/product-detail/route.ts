// POST /api/assistant/product-detail — Chat Commerce v2: detalhe rico de um
// produto pra abrir dentro do chat (galeria, composição, medidas, avaliações,
// benefícios, etiquetas).
//
// Segurança (fail-closed, mesma fronteira do resto do assistente):
//  1. API key pública → workspace
//  2. SÓ com o modo global habilitado (feature da página /chat)
//  3. Rate limit por IP
//  4. Devolve APENAS dado público de vitrine: nome/preço/imagens/URL,
//     composição, medidas, avaliações e benefícios. NUNCA quantidade de estoque
//     (só boolean disponível por tamanho), nem PII.

import { NextRequest, NextResponse } from "next/server";
import { getStorefrontCors } from "@/lib/cors";
import { validateApiKey } from "@/lib/shelves/api-key";
import { getAssistantSettings } from "@/lib/assistant/settings";
import { getProductDetails } from "@/lib/assistant/catalog";
import { getReviewsForChat } from "@/lib/assistant/commerce";
import { getActiveKnowledge } from "@/lib/assistant/knowledge";
import { hashIp } from "@/lib/assistant/guardrails";
import { checkIpRateLimit } from "@/lib/assistant/rate-limit";
import { getRequestClientIp } from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";
export const maxDuration = 20;
const MAX_BODY_BYTES = 8 * 1024;

interface Body {
  key?: unknown;
  product_id?: unknown;
}

function json(headers: Record<string, string>, status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers });
}

export async function OPTIONS(request: NextRequest) {
  const cors = await getStorefrontCors(request);
  return new NextResponse(null, {
    status: cors.allowed ? 204 : 403,
    headers: { ...cors.headers, "Access-Control-Max-Age": "86400" },
  });
}

// Etiquetas/badges do produto (só derivadas de dado público).
function buildBadges(p: {
  fit: string;
  fabric: string;
  shipping: string;
  composition: string | null;
}): string[] {
  const badges: string[] = [];
  badges.push(p.fit === "oversized" ? "Oversized" : "Regular");
  if (p.fabric === "dry") badges.push("Linha DRY");
  else if (p.fabric === "algodao") badges.push("Algodão premium");
  badges.push(/sob demanda/i.test(p.shipping) ? "Sob demanda" : "Pronta entrega");
  if (p.composition) badges.push(p.composition);
  return badges;
}

export async function POST(request: NextRequest) {
  let corsResult = await getStorefrontCors(request);
  let cors = corsResult.headers;
  if (!corsResult.allowed) {
    return json(cors, 403, { ok: false, error: "origin not allowed" });
  }

  const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return json(cors, parsed.status, { ok: false, error: parsed.error });
  }
  const body =
    parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? (parsed.value as Body)
      : {};

  const auth = await validateApiKey(typeof body.key === "string" ? body.key : null);
  if (!auth) return json(cors, 401, { ok: false, error: "invalid key" });
  const { workspaceId } = auth;

  corsResult = await getStorefrontCors(request, workspaceId);
  cors = corsResult.headers;
  if (!corsResult.allowed) {
    return json(cors, 403, { ok: false, error: "origin not allowed" });
  }

  const settings = await getAssistantSettings(workspaceId);
  if (!settings.enabled || !settings.globalEnabled) {
    return json(cors, 403, { ok: false, error: "chat commerce disabled" });
  }

  const ip = getRequestClientIp(request);
  if (!(await checkIpRateLimit(hashIp(ip)))) {
    return json(cors, 429, { ok: false, error: "rate limited" });
  }

  const productId =
    typeof body.product_id === "string" && /^[\w-]{1,40}$/.test(body.product_id)
      ? body.product_id
      : null;
  if (!productId) return json(cors, 400, { ok: false, error: "invalid product_id" });

  // Detalhe (cacheado 90s) + avaliações + benefícios ativos em paralelo.
  const [details, reviews, knowledge] = await Promise.all([
    getProductDetails(workspaceId, productId),
    getReviewsForChat(workspaceId, productId).catch(() => null),
    getActiveKnowledge(workspaceId, "product").catch(() => null),
  ]);

  if (!details) return json(cors, 404, { ok: false, error: "product not found" });

  const benefits = Array.isArray(knowledge?.benefits) ? knowledge!.benefits.slice(0, 8) : [];
  const cashbackPercent = knowledge?.cashback?.percent ? Number(knowledge.cashback.percent) : 0;

  return json(cors, 200, {
    ok: true,
    product: {
      id: details.id,
      name: details.name,
      url: details.url,
      price: details.price,
      sale_price: details.sale_price,
      available: details.available,
      images: details.images,
      composition: details.composition,
      fit: details.fit,
      fabric: details.fabric,
      shipping: details.shipping,
      description: details.description,
      sizes: details.sizes,
      size_guide: details.sizeGuide,
      badges: buildBadges(details),
    },
    reviews,
    benefits,
    cashback_percent: cashbackPercent,
  });
}
