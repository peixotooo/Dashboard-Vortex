import { createAdminClient } from "@/lib/supabase-admin";
import {
  getVndaConfig,
  searchVndaProducts,
  getVndaOrders,
  type VndaSearchProduct,
} from "@/lib/vnda-api";
import { getGA4Report } from "@/lib/ga4-api";

// --- Types ---

export interface RecommendationParams {
  workspaceId: string;
  algorithm: string;
  consumerId?: string;
  productId?: string;
  limit: number;
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

async function getWorkspaceVndaConfig(workspaceId: string) {
  const config = await getVndaConfig(workspaceId);
  if (!config) {
    throw new Error("VNDA not configured for this workspace");
  }
  return config;
}

// --- Main entry point ---

export async function getRecommendations(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
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
    default:
      throw new Error(`Unknown algorithm: ${params.algorithm}`);
  }
}

// --- Algorithms ---

/** Bestsellers: Top products by real sales revenue (VNDA Orders API, last 30 days) */
async function getBestsellers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getWorkspaceVndaConfig(params.workspaceId);

  // Fetch confirmed orders from last 30 days
  const orders = await getVndaOrders({
    config,
    datePreset: "last_30d",
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
    // No orders — fall back to news
    return getNews(params);
  }

  // Sort by revenue descending
  const topNames = [...salesMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name]) => name);

  // Fetch product catalog from VNDA to match by name
  const catalog = await searchVndaProducts(config, { per_page: "100" });
  const catalogByName = new Map<string, VndaSearchProduct>();
  for (const p of catalog) {
    if (p.available && p.active) {
      catalogByName.set(p.name, p);
    }
  }

  // Match bestsellers to catalog products, preserving sales ranking
  const results: ShelfProduct[] = [];
  for (const name of topNames) {
    const product = catalogByName.get(name);
    if (product) {
      results.push(mapVndaToShelf(product, config.storeHost));
      if (results.length >= params.limit) break;
    }
  }

  // If not enough matches, pad with remaining catalog products
  if (results.length < params.limit) {
    const usedIds = new Set(results.map((r) => r.product_id));
    for (const p of catalog) {
      if (results.length >= params.limit) break;
      if (!usedIds.has(String(p.id)) && p.available && p.active) {
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
  const config = await getWorkspaceVndaConfig(params.workspaceId);

  const products = await searchVndaProducts(config, {
    per_page: String(params.limit),
    sort: "newest",
  });

  return products
    .filter((p) => p.available && p.active)
    .slice(0, params.limit)
    .map((p) => mapVndaToShelf(p, config.storeHost));
}

/** Offers: Products currently on sale from VNDA */
async function getOffers(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getWorkspaceVndaConfig(params.workspaceId);

  const products = await searchVndaProducts(config, { per_page: "100" });

  return products
    .filter((p) => p.on_sale && p.available && p.active)
    .slice(0, params.limit)
    .map((p) => mapVndaToShelf(p, config.storeHost));
}

/** MostPopular: Most viewed products via GA4 analytics */
async function getMostPopular(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const config = await getWorkspaceVndaConfig(params.workspaceId);

  // Try GA4 for view-based popularity
  try {
    const ga4Report = await getGA4Report({
      dimensions: ["itemName"],
      metrics: ["itemsViewed"],
      orderBy: { metric: "itemsViewed", desc: true },
      limit: 50,
      datePreset: "last_7d",
    });

    if (ga4Report.rows.length > 0) {
      // Get product names ranked by views
      const viewedNames = ga4Report.rows
        .filter((r) => r.dimensions.itemName && r.metrics.itemsViewed > 0)
        .map((r) => r.dimensions.itemName);

      // Fetch catalog and match by name
      const catalog = await searchVndaProducts(config, { per_page: "100" });
      const catalogByName = new Map<string, VndaSearchProduct>();
      for (const p of catalog) {
        if (p.available && p.active) {
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

  // Fallback: use bestsellers ranking
  return getBestsellers(params);
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

  // Enrich with VNDA data instead of shelf_products table
  try {
    const config = await getWorkspaceVndaConfig(params.workspaceId);
    const catalog = await searchVndaProducts(config, { per_page: "100" });
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
