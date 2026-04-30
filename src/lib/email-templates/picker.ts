// src/lib/email-templates/picker.ts
//
// Slot pickers cross workspace's local shelf_products mirror with GA4 metrics
// to choose one product per slot. Anti-repetition is enforced by checking
// past email_template_suggestions on (workspace_id, slot, vnda_product_id).
//
// Notes for v2:
//   - shelf_products.in_stock is BOOLEAN — settings.min_stock_bestseller is
//     accepted but ignored until numeric stock is synced.
//   - GA4 property is global, workspace_id is informational only.

import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";
import type { ProductSnapshot, EmailTemplateSettings, Slot } from "./types";

interface ShelfRow {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
  tags: unknown;
  created_at: string;
}

export interface PickResult {
  product: ProductSnapshot | null;
  reason?: "no_ga4" | "no_shelf_data" | "no_candidate" | "all_recently_used";
}

// ---------- helpers ----------

async function recentlyUsedProductIds(
  workspace_id: string,
  slot: Slot,
  days: number
): Promise<Set<string>> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("vnda_product_id")
    .eq("workspace_id", workspace_id)
    .eq("slot", slot)
    .gte("generated_for_date", sinceIso);
  return new Set((data ?? []).map((r) => r.vnda_product_id as string));
}

function toSnapshot(row: ShelfRow): ProductSnapshot {
  const price = Number(row.sale_price ?? row.price ?? 0);
  const old_price =
    row.sale_price != null && row.price != null && Number(row.price) > Number(row.sale_price)
      ? Number(row.price)
      : undefined;
  const tags: string[] = Array.isArray(row.tags)
    ? (row.tags as Array<{ name?: string } | string>).map((t) =>
        typeof t === "string" ? t : t?.name ?? ""
      ).filter(Boolean)
    : [];
  return {
    vnda_id: row.product_id,
    name: row.name,
    price,
    old_price,
    image_url: row.image_url ?? "",
    url: row.product_url ?? "",
    description: undefined,
    tags,
  };
}

async function fetchShelf(
  workspace_id: string,
  filters: {
    in_stock?: boolean;
    active?: boolean;
    created_after_iso?: string;
    created_before_iso?: string;
    ids?: string[];
  }
): Promise<ShelfRow[]> {
  const supabase = createAdminClient();
  let q = supabase
    .from("shelf_products")
    .select("product_id, name, price, sale_price, image_url, product_url, tags, created_at")
    .eq("workspace_id", workspace_id);
  if (filters.active !== false) q = q.eq("active", true);
  if (filters.in_stock !== false) q = q.eq("in_stock", true);
  if (filters.created_after_iso) q = q.gte("created_at", filters.created_after_iso);
  if (filters.created_before_iso) q = q.lte("created_at", filters.created_before_iso);
  if (filters.ids && filters.ids.length > 0) q = q.in("product_id", filters.ids);
  const { data } = await q.limit(2000);
  return (data ?? []) as ShelfRow[];
}

// ---------- pickers ----------

export async function pickBestseller(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  // 1. Top item ids from GA4 by revenue (last N days)
  let topIds: string[] = [];
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(
      Date.now() - settings.bestseller_lookback_days * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    const report = await getGA4Report({
      startDate,
      endDate,
      dimensions: ["itemId"],
      metrics: ["itemRevenue", "addToCarts"],
      limit: 30,
      orderBy: { metric: "itemRevenue", desc: true },
    });
    topIds = (report?.rows ?? [])
      .map((r) => String(r.dimensions?.itemId ?? ""))
      .filter(Boolean);
  } catch (err) {
    console.error("[email-templates/picker] pickBestseller GA4 failed:", (err as Error).message);
    return { product: null, reason: "no_ga4" };
  }
  if (topIds.length === 0) return { product: null, reason: "no_candidate" };

  const used = await recentlyUsedProductIds(workspace_id, 1, 7);
  const candidateIds = topIds.filter((id) => !used.has(id));
  if (candidateIds.length === 0) return { product: null, reason: "all_recently_used" };

  const shelf = await fetchShelf(workspace_id, { ids: candidateIds });
  if (shelf.length === 0) return { product: null, reason: "no_shelf_data" };

  // Preserve GA4 ordering, return first available product
  const byId = new Map(shelf.map((r) => [r.product_id, r]));
  for (const id of candidateIds) {
    const r = byId.get(id);
    if (r) return { product: toSnapshot(r) };
  }
  return { product: null, reason: "no_candidate" };
}

export async function pickSlowmoving(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  // Candidates: in_stock + active + created at least N days ago
  const cutoff = new Date(
    Date.now() - settings.slowmoving_lookback_days * 24 * 60 * 60 * 1000
  ).toISOString();
  const shelf = await fetchShelf(workspace_id, { created_before_iso: cutoff });
  if (shelf.length === 0) return { product: null, reason: "no_shelf_data" };

  // Sales per product from GA4
  const idList = shelf.map((r) => r.product_id);
  let salesById: Record<string, number> = {};
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(
      Date.now() - settings.slowmoving_lookback_days * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    const report = await getGA4Report({
      startDate,
      endDate,
      dimensions: ["itemId"],
      metrics: ["itemPurchaseQuantity"],
      limit: 5000,
    });
    for (const r of report?.rows ?? []) {
      const id = String(r.dimensions?.itemId ?? "");
      salesById[id] = Number(r.metrics?.itemPurchaseQuantity ?? 0);
    }
  } catch (err) {
    console.error("[email-templates/picker] pickSlowmoving GA4 failed:", (err as Error).message);
    return { product: null, reason: "no_ga4" };
  }

  const used = await recentlyUsedProductIds(workspace_id, 2, 14);

  type Scored = { row: ShelfRow; sales: number; score: number };
  const scored: Scored[] = shelf
    .filter((r) => !used.has(r.product_id))
    .map((row) => {
      const sales = salesById[row.product_id] ?? 0;
      return { row, sales, score: 1 / (sales + 1) };
    })
    .filter((x) => x.sales <= settings.slowmoving_max_sales);

  if (scored.length === 0) {
    return { product: null, reason: used.size > 0 ? "all_recently_used" : "no_candidate" };
  }

  scored.sort((a, b) => b.score - a.score);
  return { product: toSnapshot(scored[0].row) };
}

export async function pickNewarrival(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  const since = new Date(
    Date.now() - settings.newarrival_lookback_days * 24 * 60 * 60 * 1000
  ).toISOString();
  const shelf = await fetchShelf(workspace_id, { created_after_iso: since });
  if (shelf.length === 0) return { product: null, reason: "no_candidate" };

  const used = await recentlyUsedProductIds(workspace_id, 3, 14);
  const sorted = shelf
    .filter((r) => !used.has(r.product_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (sorted.length === 0) return { product: null, reason: "all_recently_used" };
  return { product: toSnapshot(sorted[0]) };
}
