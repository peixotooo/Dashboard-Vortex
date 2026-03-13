import { createAdminClient } from "@/lib/supabase-admin";

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

/** BestSellers: Top products by order count (30-day window) */
async function getBestsellers(params: RecommendationParams): Promise<ShelfProduct[]> {
  const admin = createAdminClient();

  // Try pre-computed rankings first
  const { data: rankings } = await admin
    .from("shelf_rankings")
    .select("product_id")
    .eq("workspace_id", params.workspaceId)
    .eq("algorithm", "bestsellers")
    .order("score", { ascending: false })
    .limit(params.limit);

  if (rankings && rankings.length > 0) {
    const ids = rankings.map((r) => r.product_id);
    return fetchProductsByIds(params.workspaceId, ids);
  }

  // Fallback: compute on-the-fly from events
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: events } = await admin
    .from("shelf_events")
    .select("product_id")
    .eq("workspace_id", params.workspaceId)
    .eq("event_type", "order")
    .not("product_id", "is", null)
    .gte("created_at", thirtyDaysAgo);

  if (!events || events.length === 0) {
    // No orders yet — fall back to most recent products
    return getNews(params);
  }

  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.product_id, (counts.get(e.product_id) || 0) + 1);
  }

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.limit)
    .map(([id]) => id);

  return fetchProductsByIds(params.workspaceId, sorted);
}

/** News: Most recent products by created_at */
async function getNews(params: RecommendationParams): Promise<ShelfProduct[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("shelf_products")
    .select(PRODUCT_COLUMNS)
    .eq("workspace_id", params.workspaceId)
    .eq("active", true)
    .eq("in_stock", true)
    .order("created_at", { ascending: false })
    .limit(params.limit);

  return (data as ShelfProduct[]) || [];
}

/** Offers: Products with sale_price set */
async function getOffers(params: RecommendationParams): Promise<ShelfProduct[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("shelf_products")
    .select(PRODUCT_COLUMNS)
    .eq("workspace_id", params.workspaceId)
    .eq("active", true)
    .eq("in_stock", true)
    .not("sale_price", "is", null)
    .order("updated_at", { ascending: false })
    .limit(params.limit);

  return (data as ShelfProduct[]) || [];
}

/** MostPopular: Pageviews with temporal decay (7-day window) */
async function getMostPopular(
  params: RecommendationParams
): Promise<ShelfProduct[]> {
  const admin = createAdminClient();

  // Try pre-computed rankings first
  const { data: rankings } = await admin
    .from("shelf_rankings")
    .select("product_id")
    .eq("workspace_id", params.workspaceId)
    .eq("algorithm", "most_popular")
    .order("score", { ascending: false })
    .limit(params.limit);

  if (rankings && rankings.length > 0) {
    const ids = rankings.map((r) => r.product_id);
    return fetchProductsByIds(params.workspaceId, ids);
  }

  // Fallback: compute on-the-fly with decay
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: events } = await admin
    .from("shelf_events")
    .select("product_id, created_at")
    .eq("workspace_id", params.workspaceId)
    .eq("event_type", "pageview")
    .not("product_id", "is", null)
    .gte("created_at", sevenDaysAgo);

  if (!events || events.length === 0) {
    return getNews(params);
  }

  const now = Date.now();
  const scores = new Map<string, number>();

  for (const e of events) {
    const ageHours =
      (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60);
    // Half-life of 48 hours
    const decayFactor = Math.exp(-ageHours / 48);
    scores.set(e.product_id, (scores.get(e.product_id) || 0) + decayFactor);
  }

  const sorted = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.limit)
    .map(([id]) => id);

  return fetchProductsByIds(params.workspaceId, sorted);
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

  const ids = history.map((h) => h.product_id);
  return fetchProductsByIds(params.workspaceId, ids);
}

// --- Helpers ---

const PRODUCT_COLUMNS =
  "product_id, name, price, sale_price, image_url, image_url_2, product_url, category, tags, in_stock";

/** Fetch products by IDs preserving order */
async function fetchProductsByIds(
  workspaceId: string,
  productIds: string[]
): Promise<ShelfProduct[]> {
  if (productIds.length === 0) return [];

  const admin = createAdminClient();

  const { data } = await admin
    .from("shelf_products")
    .select(PRODUCT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .in("product_id", productIds);

  if (!data) return [];

  // Preserve the original order
  const map = new Map(
    (data as ShelfProduct[]).map((p) => [p.product_id, p])
  );
  return productIds
    .map((id) => map.get(id))
    .filter((p): p is ShelfProduct => p != null);
}
