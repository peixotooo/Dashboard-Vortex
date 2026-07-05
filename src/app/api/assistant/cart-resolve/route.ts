// POST /api/assistant/cart-resolve — Chat Commerce v2: resolve produto + tamanho
// no SKU de variante da VNDA, pra montar o carrinho no chat.
//
// Segurança (fail-closed, mesma fronteira do resto do assistente):
//  1. API key pública → workspace
//  2. SÓ funciona com o modo global habilitado (é feature da página /chat)
//  3. Rate limit por IP
//  4. Devolve APENAS dado público: nome, preço, imagem, URL, SKU de variante
//     (o SKU já é público no <form add-to-cart> de toda PDP) e boolean available.
//     NUNCA quantidade de estoque.

import { NextRequest, NextResponse } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAssistantSettings } from "@/lib/assistant/settings";
import { getCartVariants, normalizeSize } from "@/lib/assistant/catalog";
import { hashIp } from "@/lib/assistant/guardrails";
import { checkIpRateLimit } from "@/lib/assistant/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;

interface Body {
  key?: unknown;
  product_id?: unknown;
  size?: unknown;
}

function json(request: NextRequest, status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: buildCorsHeaders(request) });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(request), "Access-Control-Max-Age": "86400" },
  });
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json(request, 400, { ok: false, error: "invalid body" });
  }

  const auth = await validateApiKey(typeof body.key === "string" ? body.key : null);
  if (!auth) return json(request, 401, { ok: false, error: "invalid key" });
  const { workspaceId } = auth;

  // Habilitado basta: o cart-resolve serve tanto o /chat (v2) quanto o
  // add-to-cart do widget de PDP (v1). Só devolve dado público (SKU de variante).
  const settings = await getAssistantSettings(workspaceId);
  if (!settings.enabled) {
    return json(request, 403, { ok: false, error: "assistant disabled" });
  }

  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown";
  if (!checkIpRateLimit(hashIp(ip))) {
    return json(request, 429, { ok: false, error: "rate limited" });
  }

  const productId =
    typeof body.product_id === "string" && /^[\w-]{1,40}$/.test(body.product_id)
      ? body.product_id
      : null;
  if (!productId) return json(request, 400, { ok: false, error: "invalid product_id" });

  const wantSize =
    typeof body.size === "string" && body.size.trim()
      ? normalizeSize(body.size)
      : null;

  // Card público do espelho local
  const admin = createAdminClient();
  const { data: prod } = await admin
    .from("shelf_products")
    .select("product_id, name, price, sale_price, image_url, product_url, in_stock")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .maybeSingle();

  if (!prod) return json(request, 404, { ok: false, error: "product not found" });

  // Card público — vai em TODA resposta (inclusive as ok:false) pra o cliente
  // conseguir montar um seletor de tamanho ou uma mensagem clara sem re-buscar.
  const card = {
    product_id: productId,
    name: String(prod.name || ""),
    price: prod.price !== null ? Number(prod.price) : null,
    sale_price: prod.sale_price !== null ? Number(prod.sale_price) : null,
    image_url: prod.image_url || null,
    url: prod.product_url || null,
  };

  const variants = await getCartVariants(workspaceId, productId);
  if (variants.length === 0) {
    return json(request, 200, { ok: false, error: "no_variants", need_size: false, ...card });
  }

  // Escolhe a variante: pelo tamanho pedido (disponível primeiro), ou a única
  // se o produto não tiver variação de tamanho, ou informa que precisa do tamanho.
  const sized = variants.filter((v) => v.size);
  let chosen = null as (typeof variants)[number] | null;

  if (wantSize) {
    const matches = variants.filter((v) => v.size && normalizeSize(v.size) === wantSize);
    chosen = matches.find((v) => v.available) || matches[0] || null;
    if (!chosen) {
      return json(request, 200, {
        ok: false,
        error: "size_unavailable",
        need_size: true,
        available_sizes: sized.filter((v) => v.available).map((v) => v.size),
        ...card,
      });
    }
  } else if (sized.length <= 1) {
    // Produto sem variação de tamanho (ou só uma) → adiciona direto
    chosen = variants.find((v) => v.available) || variants[0];
  } else {
    // Tem vários tamanhos e o cliente não escolheu → pede pra escolher
    return json(request, 200, {
      ok: false,
      error: "need_size",
      need_size: true,
      available_sizes: sized.filter((v) => v.available).map((v) => v.size),
      ...card,
    });
  }

  if (!chosen.available) {
    return json(request, 200, {
      ok: false,
      error: "unavailable",
      need_size: sized.length > 1,
      available_sizes: sized.filter((v) => v.available).map((v) => v.size),
      ...card,
    });
  }

  return json(request, 200, {
    ok: true,
    sku: chosen.sku,
    size: chosen.size,
    ...card,
  });
}
