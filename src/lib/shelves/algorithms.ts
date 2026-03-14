import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import {
  listVndaProducts,
  searchVndaProducts,
  getVndaOrders,
  type VndaSearchProduct,
  type VndaConfig,
} from "@/lib/vnda-api";
import { getGA4Report } from "@/lib/ga4-api";

// --- Types ---

export interface RecommendationParams {
  workspaceId: string;
  algorithm: string;
  consumerId?: string;
  productId?: string;
  limit: number;
  tags?: string[];
}

export interface ShelfProduct {
  product_id: string;
  name: string;
  price: number;
  sale_price: number | null;
  image_url: string | null;
  image_url_2: string | null;
  product_url: string | null;
  category: string | null;
  tags: unknown;
  in_stock: boolean;
}

// --- Helpers ---

function mapVndaToShelf(
  p: VndaSearchProduct,
  storeHost: string
): ShelfProduct {
  return {
    product_id: String(p.id),
    name: p.name,
    price: p.price,
    sale_price: p.sale_price ?? null,
    image_url: p.image_url || null,
    image_url_2: null,
    product_url: p.url?.startsWith("http")
      ? p.url
      : `https://${storeHost}${p.url}`,
    category: null,
    tags: { vnda_tags: p.tags, on_sale: p.on_sale },
    in_stock: p.available,
  };
}

// --- Per-request memoization ---
// Caches live for a single serverless invocation. Prevents duplicate API calls
// when one algorithm falls back to another (e.g., most_popular -> bestsellers).

const configCache = new Map<string, Promise<VndaConfig>>();
const catalogCache = new Map<string, Promise<VndaSearchProduct[]>>();

async function fetchVndaConfig(workspaceId: string): Promise<VndaConfig> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (data?.api_token && data?.store_host) {
    return {
      apiToken: decrypt(data.api_token),
      storeHost: data.store_host as string,
    };
  }

  const token = process.env.VNDA_API_TOKEN;
  const host = process.env.VNDA_STORE_HOST;
  if (token && host) {
    return { apiToken: token, storeHost: host };
  }

  throw new Error("VNDA not configured for this workspace");
}

function getCachedConfig(workspaceId: string): Promise<VndaConfig> {
  const cached = configCache.get(workspaceId);
  if (cached) return cached;
  const promise = fetchVndaConfig(workspaceId);
  configCache.set(workspaceId, promise);
  return promise;
}

function getCachedCatalog(
  config: VndaConfig,
  params: Record<string, string>
): Promise<VndaSearchProduct[]> {
  const key = `${config.storeHost}:${JSON.stringify(params)}`;
  const cached = catalogCache.get(key);
  if (cached) return cached;
  const promise = listVndaProducts(config, params);
  catalogCache.set(key, promise);
  return promise;
}

// --- Main entry point ---

export async function getRecommendations(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  // Clear caches to prevent stale data across warm invocations
  configCache.clear();
  catalogCache.clear();

  switch (params.algorithm) {
    case "bestsellers":
      return getBestsellers(params);
    case "news":
      return getNews(params);
    case "offers":
      return getOffers(params);
    case "most_popular":
      return getMostPopular(params);
    case "last_viewed":
      return getLastViewed(params);
    case "custom_tags":
      return getCustomTags(params);
    default:
      throw new Error(`Unknown algorithm: ${params.algorithm}`);
  }
}

// --- Algorithms ---

/** Bestsellers: Top products by real sales revenue (VNDA Orders API, last 7 days) */
async function getBestsellers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getCachedConfig(params.workspaceId);

  const orders = await getVndaOrders({
    config,
    datePreset: "last_7d",
    status: "confirmed",
  });

  // Aggregate sales by product name
  const salesMap = new Map<string, { quantity: number; revenue: number }>();
  for (const order of orders) {
    for (const item of order.items || []) {
      const name = item.product_name;
      if (!name) continue;
      const existing = salesMap.get(name) || { quantity: 0, revenue: 0 };
      existing.quantity += item.quantity || 0;
      existing.revenue += item.total || 0;
      salesMap.set(name, existing);
    }
  }

  if (salesMap.size === 0) {
    return getNews(params);
  }

  const topNames = [...salesMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name]) => name);

  const catalog = await getCachedCatalog(config, { per_page: "100" });
  const catalogByName = new Map<string, VndaSearchProduct>();
  for (const p of catalog) {
    if (p.available !== false) {
      catalogByName.set(p.name, p);
    }
  }

  const results: ShelfProduct[] = [];
  for (const name of topNames) {
    const product = catalogByName.get(name);
    if (product) {
      results.push(mapVndaToShelf(product, config.storeHost));
      if (results.length >= params.limit) break;
    }
  }

  if (results.length < params.limit) {
    const usedIds = new Set(results.map((r) => r.product_id));
    for (const p of catalog) {
      if (results.length >= params.limit) break;
      if (!usedIds.has(String(p.id)) && p.available !== false) {
        results.push(mapVndaToShelf(p, config.storeHost));
      }
    }
  }

  return results;
}

/** News: Most recent products from VNDA */
async function getNews(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getCachedConfig(params.workspaceId);

  const products = await getCachedCatalog(config, {
    per_page: String(Math.max(params.limit * 2, 50)),
  });

  return products
    .filter((p) => p.available !== false)
    .slice(0, params.limit)
    .map((p) => mapVndaToShelf(p, config.storeHost));
}

/** Offers: Products currently on sale from VNDA */
async function getOffers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getCachedConfig(params.workspaceId);

  const products = await getCachedCatalog(config, { per_page: "50" });

  return products
    .filter((p) => p.on_sale && p.available !== false)
    .slice(0, params.limit)
    .map((p) => mapVndaToShelf(p, config.storeHost));
}

/** MostPopular: Most viewed products via GA4 analytics */
async function getMostPopular(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getCachedConfig(params.workspaceId);

  try {
    const ga4Report = await getGA4Report({
      dimensions: ["itemName"],
      metrics: ["itemsViewed"],
      orderBy: { metric: "itemsViewed", desc: true },
      limit: 50,
      datePreset: "last_7d",
    });

    if (ga4Report.rows.length > 0) {
      const viewedNames = ga4Report.rows
        .filter((r) => r.dimensions.itemName && r.metrics.itemsViewed > 0)
        .map((r) => r.dimensions.itemName);

      const catalog = await getCachedCatalog(config, { per_page: "100" });
      const catalogByName = new Map<string, VndaSearchProduct>();
      for (const p of catalog) {
        if (p.available !== false) {
          catalogByName.set(p.name, p);
        }
      }

      const results: ShelfProduct[] = [];
      for (const name of viewedNames) {
        const product = catalogByName.get(name);
        if (product) {
          results.push(mapVndaToShelf(product, config.storeHost));
          if (results.length >= params.limit) break;
        }
      }

      if (results.length >= Math.min(params.limit, 4)) {
        return results;
      }
    }
  } catch {
    // GA4 not configured or failed — fall through to bestsellers
  }

  return getBestsellers(params);
}

/** CustomTags: Products filtered by specific VNDA tags (AND logic) */
async function getCustomTags(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  if (!params.tags || params.tags.length === 0) {
    return [];
  }

  const config = await getCachedConfig(params.workspaceId);
  const targetTags = params.tags.map((t) => t.toLowerCase().trim());

  // Use search endpoint (returns tags, unlike /products)
  // Do NOT pass tags param to VNDA - it causes HTTP 500. Filter locally instead.
  const products = await searchVndaProducts(config, {
    per_page: "100",
  });

  if (products.length > 0) {
    const matched = products.filter((p) => {
      if (p.available === false || !p.tags || !Array.isArray(p.tags)) return false;
      const productTagNames = p.tags.map((tag) =>
        (tag.name || "").toLowerCase().trim()
      );
      return targetTags.every((target) => productTagNames.includes(target));
    });

    return matched
      .slice(0, params.limit)
      .map((p) => mapVndaToShelf(p, config.storeHost));
  }

  // Fallback: use /products endpoint + local tag filtering
  // /products may not return tags, but try anyway (best-effort)
  const catalog = await getCachedCatalog(config, { per_page: "100" });
  const fallback = catalog.filter((p) => {
    if (p.available === false) return false;
    if (!p.tags || !Array.isArray(p.tags)) return false;
    const productTagNames = p.tags.map((tag) =>
      (tag.name || "").toLowerCase().trim()
    );
    return targetTags.some((target) => productTagNames.includes(target));
  });

  return fallback
    .slice(0, params.limit)
    .map((p) => mapVndaToShelf(p, config.storeHost));
}

/** LastViewed: Products viewed by consumer, most recent first */
async function getLastViewed(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  if (!params.consumerId) return [];

  const admin = createAdminClient();

  const { data: history } = await admin
    .from("shelf_consumer_history")
    .select("product_id")
    .eq("workspace_id", params.workspaceId)
    .eq("consumer_id", params.consumerId)
    .order("last_seen", { ascending: false })
    .limit(params.limit);

  if (!history || history.length === 0) return [];

  try {
    const config = await getCachedConfig(params.workspaceId);
    const catalog = await getCachedCatalog(config, { per_page: "50" });
    const catalogById = new Map<string, VndaSearchProduct>();
    for (const p of catalog) {
      catalogById.set(String(p.id), p);
    }

    return history
      .map((h) => {
        const product = catalogById.get(h.product_id);
        if (!product) return null;
        return mapVndaToShelf(product, config.storeHost);
      })
      .filter((p): p is ShelfProduct => p != null);
  } catch {
    return [];
  }
}
