import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";
import {
  fetchMedusaOrders,
  getMedusaEnv,
  getMedusaStoreHostname,
} from "@/lib/shelves/medusa-api";
import type { RecommendationParams, ShelfProduct } from "@/lib/shelves/algorithms";

/**
 * Algoritmos da fonte MEDUSA (loja nova, app.bulking.com.br).
 *
 * Mesma lógica do motor VNDA, torneiras diferentes:
 * - Catálogo:    shelf_products com source='medusa' (sync do Medusa Store API).
 * - Bestsellers: vendas reais da Medusa Admin API (7d). Sem MEDUSA_ADMIN_API_KEY
 *                (ou com erro) cai no fallback da cadeia, como o motor já faz.
 * - GA4:         filtrado por hostname da loja nova. Enquanto o GA4 dela não
 *                estiver ligado, vem vazio e os fallbacks assumem.
 *
 * Este módulo NUNCA chama a API da VNDA — quando a VNDA desligar, nada aqui
 * percebe.
 */

// Cópia local (evita ciclo de import com algorithms.ts).
function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type CatalogRow = ShelfProduct & { created_at?: string | null };

const SELECT_COLUMNS =
  "product_id, name, price, sale_price, image_url, image_url_2, product_url, category, tags, in_stock, created_at";

// Cache por invocação (mesmo padrão do algorithms.ts) — evita repetir a query
// quando um algoritmo cai no fallback de outro.
const catalogCache = new Map<string, Promise<CatalogRow[]>>();

export function clearMedusaAlgorithmCaches(): void {
  catalogCache.clear();
}

async function fetchMedusaCatalog(
  workspaceId: string,
  inStockOnly: boolean
): Promise<CatalogRow[]> {
  const admin = createAdminClient();
  const PAGE = 1000;
  const all: CatalogRow[] = [];
  let from = 0;

  while (true) {
    let query = admin
      .from("shelf_products")
      .select(SELECT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("source", "medusa")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (inStockOnly) query = query.eq("in_stock", true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as CatalogRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

function getCachedMedusaCatalog(
  workspaceId: string,
  inStockOnly: boolean
): Promise<CatalogRow[]> {
  const key = `${workspaceId}:${inStockOnly ? "stock" : "all"}`;
  const cached = catalogCache.get(key);
  if (cached) return cached;
  const promise = fetchMedusaCatalog(workspaceId, inStockOnly);
  catalogCache.set(key, promise);
  return promise;
}

function toShelfProduct(row: CatalogRow): ShelfProduct {
  return {
    product_id: row.product_id,
    name: row.name,
    price: Number(row.price),
    sale_price: row.sale_price != null ? Number(row.sale_price) : null,
    image_url: row.image_url || null,
    image_url_2: row.image_url_2 || null,
    product_url: row.product_url || null,
    category: row.category || null,
    tags: row.tags,
    in_stock: row.in_stock,
  };
}

/** News: produtos mais recentes do catálogo Medusa. */
export async function getMedusaNews(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const catalog = await getCachedMedusaCatalog(params.workspaceId, true);
  // Catálogo já vem ordenado por created_at desc.
  return catalog.slice(0, params.limit).map(toShelfProduct);
}

/** Offers: produtos em promoção (sale_price) do catálogo Medusa. */
export async function getMedusaOffers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const catalog = await getCachedMedusaCatalog(params.workspaceId, true);
  return catalog
    .filter((p) => p.sale_price != null && Number(p.sale_price) > 0)
    .slice(0, params.limit)
    .map(toShelfProduct);
}

/**
 * Bestsellers: vendas reais da loja Medusa (Admin API, últimos 7d, pedidos
 * pagos/capturados), agregadas por produto e casadas com o catálogo por nome
 * (mesma lógica do bestsellers VNDA). Fallback: news (Medusa).
 */
const PAID_STATUSES = new Set(["captured", "partially_captured", "paid"]);

export async function getMedusaBestsellers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const env = getMedusaEnv();
  const orders = env ? await fetchMedusaOrders(env, 7) : null;

  if (!orders || orders.length === 0) {
    return getMedusaNews(params);
  }

  const salesMap = new Map<string, { quantity: number; revenue: number }>();
  for (const order of orders) {
    const paymentStatus = (order.payment_status || "").toLowerCase();
    if (paymentStatus && !PAID_STATUSES.has(paymentStatus)) continue;
    if ((order.status || "").toLowerCase() === "canceled") continue;

    for (const item of order.items || []) {
      const name = item.product_title || item.title;
      if (!name) continue;
      const key = normalizeProductName(name);
      const existing = salesMap.get(key) || { quantity: 0, revenue: 0 };
      existing.quantity += item.quantity || 0;
      existing.revenue +=
        item.total || (item.unit_price || 0) * (item.quantity || 0) || 0;
      salesMap.set(key, existing);
    }
  }

  if (salesMap.size === 0) {
    return getMedusaNews(params);
  }

  const topNames = [...salesMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name]) => name);

  const catalog = await getCachedMedusaCatalog(params.workspaceId, true);
  const catalogByName = new Map<string, CatalogRow>();
  for (const p of catalog) {
    const key = normalizeProductName(p.name);
    if (!catalogByName.has(key)) catalogByName.set(key, p);
  }

  const results: ShelfProduct[] = [];
  const used = new Set<string>();
  for (const name of topNames) {
    const product = catalogByName.get(name);
    if (product && !used.has(product.product_id)) {
      results.push(toShelfProduct(product));
      used.add(product.product_id);
      if (results.length >= params.limit) break;
    }
  }

  // Completa com o catálogo (novidades primeiro), como o motor VNDA faz.
  if (results.length < params.limit) {
    for (const p of catalog) {
      if (results.length >= params.limit) break;
      if (!used.has(p.product_id)) {
        results.push(toShelfProduct(p));
        used.add(p.product_id);
      }
    }
  }

  return results;
}

/**
 * MostPopular: produtos mais vistos via GA4 filtrado pelo hostname da loja
 * nova. GA4 da loja nova ainda não ligado → vazio → fallback bestsellers.
 */
export async function getMedusaMostPopular(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  try {
    const ga4Report = await getGA4Report({
      dimensions: ["itemName"],
      metrics: ["itemsViewed"],
      orderBy: { metric: "itemsViewed", desc: true },
      limit: 50,
      datePreset: "last_7d",
      hostname: getMedusaStoreHostname(),
    });

    if (ga4Report.rows.length > 0) {
      const viewedNames = ga4Report.rows
        .filter((r) => r.dimensions.itemName && r.metrics.itemsViewed > 0)
        .map((r) => normalizeProductName(r.dimensions.itemName));

      const catalog = await getCachedMedusaCatalog(params.workspaceId, true);
      const catalogByName = new Map<string, CatalogRow>();
      for (const p of catalog) {
        const key = normalizeProductName(p.name);
        if (!catalogByName.has(key)) catalogByName.set(key, p);
      }

      const results: ShelfProduct[] = [];
      for (const name of viewedNames) {
        const product = catalogByName.get(name);
        if (product) {
          results.push(toShelfProduct(product));
          if (results.length >= params.limit) break;
        }
      }

      if (results.length >= Math.min(params.limit, 4)) {
        return results;
      }
    }
  } catch {
    // GA4 indisponível — segue pro fallback
  }

  return getMedusaBestsellers(params);
}

/** CustomTags: filtro AND por tags (mesmo vocabulário VNDA preservado no sync). */
export async function getMedusaCustomTags(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  if (!params.tags || params.tags.length === 0) return [];

  const targetTags = params.tags.map((t) => t.toLowerCase().trim());
  const catalog = await getCachedMedusaCatalog(params.workspaceId, true);

  const matched = catalog.filter((p) => {
    if (!Array.isArray(p.tags)) return false;
    const names = (p.tags as Array<{ name?: unknown } | string>)
      .map((tag) =>
        typeof tag === "string"
          ? tag
          : tag && typeof tag === "object" && "name" in tag
            ? String((tag as { name: unknown }).name ?? "")
            : ""
      )
      .map((n) => n.toLowerCase().trim())
      .filter(Boolean);
    return targetTags.every((target) => names.includes(target));
  });

  return matched.slice(0, params.limit).map(toShelfProduct);
}

/** LastViewed: histórico do consumidor carimbado com source='medusa'. */
export async function getMedusaLastViewed(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  if (!params.consumerId) return [];

  const admin = createAdminClient();

  const { data: history } = await admin
    .from("shelf_consumer_history")
    .select("product_id")
    .eq("workspace_id", params.workspaceId)
    .eq("consumer_id", params.consumerId)
    .eq("source", "medusa")
    .order("last_seen", { ascending: false })
    .limit(params.limit);

  if (!history || history.length === 0) return [];

  const catalog = await getCachedMedusaCatalog(params.workspaceId, false);
  const catalogById = new Map<string, CatalogRow>();
  for (const p of catalog) {
    if (!catalogById.has(p.product_id)) catalogById.set(p.product_id, p);
  }

  return history
    .map((h) => catalogById.get(String(h.product_id)))
    .filter((p): p is CatalogRow => p != null)
    .map(toShelfProduct);
}
