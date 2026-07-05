// Chat Commerce v2 — fontes de dados extras (vitrine/prateleiras + avaliações).
//
// SEGURANÇA: só dado público de vitrine, mesma fronteira do resto do assistente.
// Reusa o motor de prateleiras (getRecommendations) e as tabelas de reviews
// já expostas publicamente nos widgets — nada de estoque numérico, PII, token.

import { createAdminClient } from "@/lib/supabase-admin";
import { getRecommendations } from "@/lib/shelves/algorithms";
import type { AssistantProductCard, ReviewsBlockData } from "./types";

// Rótulos amigáveis → algoritmo do motor de prateleiras
const VITRINE_ALGOS: Record<string, string> = {
  mais_vendidos: "bestsellers",
  camisetas_mais_vendidas: "bestseller_camisetas",
  novidades: "news",
  ofertas: "offers",
  populares: "most_popular",
};

function buildUrl(productUrl: string | null, id: string): string {
  const url = (productUrl || "").trim();
  if (!url) return "";
  if (new RegExp(`-${id}(/|\\?|#|$)`).test(url)) return url;
  const [base, tail = ""] = url.split(/(?=[?#])/);
  return `${base.replace(/\/+$/, "")}-${id}${tail}`;
}

/** Prateleira de produtos (carrossel do chat). */
export async function getVitrine(
  workspaceId: string,
  vitrine: string,
  limit = 8
): Promise<AssistantProductCard[]> {
  const algorithm = VITRINE_ALGOS[vitrine] || "bestsellers";
  try {
    const rows = await getRecommendations({
      workspaceId,
      algorithm,
      limit: Math.min(Math.max(limit, 3), 10),
    });
    return rows
      .filter((p) => p.product_id && p.name)
      .map((p) => ({
        id: String(p.product_id),
        name: p.name,
        url: buildUrl(p.product_url, String(p.product_id)),
        image_url: p.image_url,
        price: p.price ?? null,
        sale_price: p.sale_price ?? null,
        available: p.in_stock !== false,
      }));
  } catch {
    return [];
  }
}

function displayName(raw: string): string {
  const name = String(raw || "").trim();
  if (!name) return "Cliente";
  const parts = name.split(/\s+/);
  return parts.length > 1
    ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
    : parts[0];
}

/**
 * Prova social: destaques da loja (padrão) ou avaliações de um produto.
 * Retorna média, contagem e alguns destaques positivos — nome abreviado (LGPD).
 */
export async function getReviewsForChat(
  workspaceId: string,
  productId?: string | null
): Promise<ReviewsBlockData | null> {
  const admin = createAdminClient();

  if (productId) {
    const { data } = await admin
      .from("reviews")
      .select("rating, title, body, author_name")
      .eq("workspace_id", workspaceId)
      .eq("product_id", String(productId))
      .eq("status", "published")
      .order("reviewed_at", { ascending: false })
      .limit(50);
    const rows = data || [];
    if (rows.length === 0) return getReviewsForChat(workspaceId, null);
    const avg = rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length;
    const highlights = rows
      .filter((r) => Number(r.rating) >= 4 && String(r.body || "").trim().length > 15)
      .slice(0, 4)
      .map((r) => ({
        rating: Number(r.rating) || 5,
        body: String(r.body || "").slice(0, 240),
        author: displayName(String(r.author_name || "")),
      }));
    return { scope: "product", average: Math.round(avg * 10) / 10, count: rows.length, highlights };
  }

  const { data } = await admin
    .from("store_reviews")
    .select("rating, body, author_name")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("rating", 4)
    .order("reviewed_at", { ascending: false })
    .limit(60);
  const rows = data || [];
  if (rows.length === 0) return null;
  const avg = rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length;
  const highlights = rows
    .filter((r) => String(r.body || "").trim().length > 20)
    .slice(0, 4)
    .map((r) => ({
      rating: Number(r.rating) || 5,
      body: String(r.body || "").slice(0, 240),
      author: displayName(String(r.author_name || "")),
    }));
  return { scope: "store", average: Math.round(avg * 10) / 10, count: rows.length, highlights };
}
