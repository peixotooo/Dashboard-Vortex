// Computes per-product performance for coupon-rotation decisions.
// Combines GA4 itemsViewed (last 30d) with VNDA confirmed orders (last 30d),
// classifies each product into ABC tiers, and assigns a "low_rotation_score"
// to surface candidates that are visited a lot but rarely convert.

import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";
import { getVndaOrders } from "@/lib/vnda-api";
import { decrypt } from "@/lib/encryption";

export interface ProductPerformance {
  product_id: string;
  name: string;
  effective_price: number;
  views: number;
  units_sold: number;
  revenue: number;
  cvr: number;
  abc_tier: "A" | "B" | "C";
  low_rotation_score: number;
}

interface ShelfProductRow {
  product_id: string;
  name: string;
  sku: string | null;
  price: number | null;
  sale_price: number | null;
}

async function getVndaConfig(workspaceId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (data?.api_token && data?.store_host) {
    return { apiToken: decrypt(data.api_token), storeHost: data.store_host as string };
  }
  return null;
}

function normalizeName(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export async function computeProductPerformance(workspaceId: string): Promise<ProductPerformance[]> {
  const admin = createAdminClient();

  // 1. Pull all active+in_stock products
  const products: ShelfProductRow[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("shelf_products")
      .select("product_id, name, sku, price, sale_price")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    products.push(...(data as ShelfProductRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  // Fast lookups by id, name, sku
  const byId = new Map<string, ShelfProductRow>();
  const byName = new Map<string, ShelfProductRow>();
  const bySku = new Map<string, ShelfProductRow>();
  for (const p of products) {
    byId.set(p.product_id, p);
    byName.set(normalizeName(p.name), p);
    if (p.sku) bySku.set(p.sku.trim(), p);
  }

  // 2. GA4 views — itemId first, then itemName fallback
  const viewsByPid = new Map<string, number>();
  if (process.env.GA4_PROPERTY_ID) {
    try {
      const [byIdRes, byNameRes] = await Promise.all([
        getGA4Report({
          dimensions: ["itemId"],
          metrics: ["itemsViewed"],
          datePreset: "last_30d",
          limit: 5000,
        }).catch(() => ({ rows: [] })),
        getGA4Report({
          dimensions: ["itemName"],
          metrics: ["itemsViewed"],
          datePreset: "last_30d",
          limit: 5000,
        }).catch(() => ({ rows: [] })),
      ]);

      for (const r of byIdRes.rows || []) {
        const id = r.dimensions.itemId;
        if (!id) continue;
        const v = Number(r.metrics.itemsViewed) || 0;
        if (v > 0 && byId.has(id)) {
          viewsByPid.set(id, (viewsByPid.get(id) || 0) + v);
        }
      }
      for (const r of byNameRes.rows || []) {
        const n = normalizeName(r.dimensions.itemName || "");
        const p = byName.get(n);
        if (!p) continue;
        const v = Number(r.metrics.itemsViewed) || 0;
        // Only fill if itemId didn't already cover it
        if (v > 0 && !viewsByPid.has(p.product_id)) {
          viewsByPid.set(p.product_id, v);
        }
      }
    } catch (e) {
      console.error("[Coupons/Perf] GA4 fetch failed:", e);
    }
  }

  // 3. VNDA orders last 30d — aggregate per product
  const unitsByPid = new Map<string, number>();
  const revenueByPid = new Map<string, number>();
  const vndaConfig = await getVndaConfig(workspaceId);
  if (vndaConfig) {
    try {
      const orders = await getVndaOrders({
        config: vndaConfig,
        datePreset: "last_30d",
        status: "confirmed",
      });
      for (const o of orders) {
        for (const it of o.items || []) {
          // Match item to product: try sku first (more reliable across name changes),
          // fallback to product_name
          let p: ShelfProductRow | undefined;
          if (it.sku) {
            // VNDA SKU may belong to a variant. Try parent first, then walk back to base SKU
            p = bySku.get(it.sku.trim());
            if (!p) {
              // Try stripping variant suffix (e.g., "1290-P-PRETA" → "1290")
              const base = it.sku.split(/[-_]/)[0];
              if (base && byId.has(base)) p = byId.get(base);
            }
          }
          if (!p) p = byName.get(normalizeName(it.product_name || ""));
          if (!p) continue;

          unitsByPid.set(p.product_id, (unitsByPid.get(p.product_id) || 0) + (it.quantity || 0));
          revenueByPid.set(p.product_id, (revenueByPid.get(p.product_id) || 0) + (it.total || 0));
        }
      }
    } catch (e) {
      console.error("[Coupons/Perf] VNDA orders fetch failed:", e);
    }
  }

  // 4. Build per-product performance rows
  const rows: ProductPerformance[] = products.map((p) => {
    const views = viewsByPid.get(p.product_id) || 0;
    const units = unitsByPid.get(p.product_id) || 0;
    const revenue = revenueByPid.get(p.product_id) || 0;
    const cvr = views > 0 ? units / views : 0;
    const effective = (p.sale_price && p.sale_price > 0 ? p.sale_price : p.price) || 0;
    return {
      product_id: p.product_id,
      name: p.name,
      effective_price: effective,
      views,
      units_sold: units,
      revenue,
      cvr,
      abc_tier: "C" as const,
      low_rotation_score: 0,
    };
  });

  // 5. ABC by revenue (Pareto)
  const sortedRev = [...rows].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sortedRev.reduce((s, r) => s + r.revenue, 0);
  let cum = 0;
  const tierByPid = new Map<string, "A" | "B" | "C">();
  for (const r of sortedRev) {
    if (totalRevenue === 0) {
      tierByPid.set(r.product_id, "C");
      continue;
    }
    cum += r.revenue;
    const cumPct = cum / totalRevenue;
    tierByPid.set(r.product_id, cumPct <= 0.5 ? "A" : cumPct <= 0.8 ? "B" : "C");
  }

  // 6. Percentile helpers for the score
  function buildPercentileMap<T>(arr: T[], getValue: (x: T) => number, key: (x: T) => string): Map<string, number> {
    const sorted = [...arr].sort((a, b) => getValue(a) - getValue(b));
    const map = new Map<string, number>();
    sorted.forEach((x, i) => map.set(key(x), arr.length > 1 ? i / (arr.length - 1) : 0.5));
    return map;
  }
  const viewsP = buildPercentileMap(rows, (r) => r.views, (r) => r.product_id);
  const cvrP = buildPercentileMap(rows.filter((r) => r.views > 0), (r) => r.cvr, (r) => r.product_id);
  const revP = buildPercentileMap(rows, (r) => r.revenue, (r) => r.product_id);

  // 7. Final assignment: tier + low_rotation_score
  // score = views_pct·0.4 + (1-cvr_pct)·0.4 + (1-rev_pct)·0.2
  // High views, low CVR, low revenue → highest score (best candidate)
  for (const r of rows) {
    r.abc_tier = tierByPid.get(r.product_id) || "C";
    const vP = viewsP.get(r.product_id) ?? 0;
    const cP = cvrP.get(r.product_id) ?? 0; // products with 0 views excluded → score lower naturally
    const rP = revP.get(r.product_id) ?? 0;
    const score = vP * 0.4 + (1 - cP) * 0.4 + (1 - rP) * 0.2;
    r.low_rotation_score = Math.max(0, Math.min(1, score));
  }

  return rows;
}

/**
 * Persist a freshly-computed snapshot to shelf_product_performance.
 */
export async function persistPerformanceSnapshot(
  workspaceId: string,
  rows: ProductPerformance[]
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    workspace_id: workspaceId,
    product_id: r.product_id,
    period_days: 30,
    computed_at: now,
    views: r.views,
    units_sold: r.units_sold,
    revenue: r.revenue,
    cvr: r.cvr,
    abc_tier: r.abc_tier,
    low_rotation_score: r.low_rotation_score,
  }));

  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const { error } = await admin
      .from("shelf_product_performance")
      .upsert(slice, { onConflict: "workspace_id,product_id,period_days" });
    if (error) throw new Error(error.message);
  }
}
