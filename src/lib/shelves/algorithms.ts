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
  priceMin?: number;
  priceMax?: number;
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
    case "related_products":
      return getRelatedProducts(params);
    case "price_range":
      return getPriceRange(params);
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

/** PriceRange: Products within a price band (uses sale_price when present, else price) */
async function getPriceRange(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const min = Number.isFinite(params.priceMin) ? (params.priceMin as number) : 0;
  const max = Number.isFinite(params.priceMax) ? (params.priceMax as number) : null;
  if (max !== null && (max <= 0 || max < min)) return [];

  // Query the synced shelf_products table directly so we cover the entire
  // catalog (the VNDA listing endpoint only returns a single page; with 1300+
  // SKUs the price filter would silently miss most matches).
  const admin = createAdminClient();

  // Pull active+in_stock products and filter by effective price (sale_price ?? price)
  // in JS — Postgres COALESCE works too but doing it client-side keeps the
  // query simple and consistent with the rest of the matcher logic.
  const PAGE = 1000;
  const all: Array<{
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
  }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("shelf_products")
      .select(
        "product_id, name, price, sale_price, image_url, image_url_2, product_url, category, tags, in_stock"
      )
      .eq("workspace_id", params.workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as typeof all));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const effective = (p: { price: number; sale_price: number | null }) =>
    p.sale_price && p.sale_price > 0 ? p.sale_price : p.price;

  const matched = all
    .filter((p) => {
      const price = effective(p);
      if (typeof price !== "number" || price < min) return false;
      if (max !== null && price > max) return false;
      return true;
    })
    .sort((a, b) => effective(a) - effective(b))
    .slice(0, params.limit);

  return matched.map((p) => ({
    product_id: p.product_id,
    name: p.name,
    price: p.price,
    sale_price: p.sale_price,
    image_url: p.image_url,
    image_url_2: p.image_url_2,
    product_url: p.product_url,
    category: p.category,
    tags: p.tags,
    in_stock: p.in_stock,
  }));
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

/** Extract normalized tag strings from mixed tag formats (strings or {name} objects) */
function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t: unknown) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object" && "name" in t) return String((t as { name: unknown }).name);
      return "";
    })
    .filter(Boolean)
    .map((t) => t.toLowerCase().trim());
}

/** Extract meaningful keywords from a product name, filtering stopwords */
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "em", "com", "para", "por", "e", "ou",
  "um", "uma", "uns", "umas", "o", "a", "os", "as", "no", "na", "nos", "nas",
  "ao", "aos", "pelo", "pela", "que", "se", "c", "p", "s", "m", "l", "g",
  "pp", "gg", "xg", "ml", "kg", "cm", "un", "und", "pct", "cx", "kit",
]);

function extractNameKeywords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .split(/[\s\-\/\|,.:;()+]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** RelatedProducts: Products similar by name keywords, tags, and category */
async function getRelatedProducts(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  if (!params.productId) {
    return getBestsellers(params);
  }

  const admin = createAdminClient();

  // Look up the source product in shelf_products (synced catalog)
  const { data: sourceProduct } = await admin
    .from("shelf_products")
    .select("product_id, name, category, tags")
    .eq("workspace_id", params.workspaceId)
    .eq("product_id", params.productId)
    .single();

  if (!sourceProduct) {
    return getBestsellers(params);
  }

  const sourceCategory = sourceProduct.category || null;
  const sourceTags = normalizeTags(sourceProduct.tags);
  const sourceKeywords = extractNameKeywords(sourceProduct.name);

  // Fetch all active candidates (broad query — scoring decides relevance)
  const { data: candidates } = await admin
    .from("shelf_products")
    .select(
      "product_id, name, category, tags, price, sale_price, image_url, image_url_2, product_url, in_stock"
    )
    .eq("workspace_id", params.workspaceId)
    .eq("active", true)
    .eq("in_stock", true)
    .neq("product_id", params.productId)
    .limit(200);

  if (!candidates || candidates.length === 0) {
    return getBestsellers(params);
  }

  // Score candidates by similarity
  const scored = candidates.map((candidate) => {
    let score = 0;

    // Same category = +10
    if (sourceCategory && candidate.category === sourceCategory) {
      score += 10;
    }

    // Shared tags = +3 each
    if (sourceTags.length > 0) {
      const candidateTags = normalizeTags(candidate.tags);
      for (const tag of sourceTags) {
        if (candidateTags.includes(tag)) {
          score += 3;
        }
      }
    }

    // Shared name keywords = +5 each (strong collection signal)
    if (sourceKeywords.length > 0) {
      const candidateKeywords = extractNameKeywords(candidate.name);
      for (const kw of sourceKeywords) {
        if (candidateKeywords.includes(kw)) {
          score += 5;
        }
      }
    }

    return { ...candidate, score };
  });

  // Filter out zero-score (unrelated) products, sort by score desc
  const relevant = scored
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // If no relevant products found, fall back to bestsellers
  if (relevant.length === 0) {
    return getBestsellers(params);
  }

  return relevant.slice(0, params.limit).map((p) => ({
    product_id: p.product_id,
    name: p.name,
    price: Number(p.price),
    sale_price: p.sale_price != null ? Number(p.sale_price) : null,
    image_url: p.image_url || null,
    image_url_2: p.image_url_2 || null,
    product_url: p.product_url || null,
    category: p.category || null,
    tags: { vnda_tags: p.tags || [] },
    in_stock: p.in_stock,
  }));
}
