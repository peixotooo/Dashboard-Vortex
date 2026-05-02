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

/**
 * Cross-slot product cooldown — don't reuse the same product on ANY slot
 * within the window. Forces the daily blast to feature distinct items even
 * if a different slot picker would have grabbed it.
 */
async function recentlyUsedAcrossSlots(
  workspace_id: string,
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
    .gte("generated_for_date", sinceIso);
  return new Set((data ?? []).map((r) => r.vnda_product_id as string));
}

/**
 * Tag-frequency map for products used in the last N days. Used to penalize
 * candidates whose tags overlap heavily with the recent rotation, so we
 * don't run "shorts" three days in a row even when GA4 keeps surfacing
 * them. Higher count = more recent saturation.
 */
async function recentTagFrequency(
  workspace_id: string,
  days: number
): Promise<Map<string, number>> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("product_snapshot")
    .eq("workspace_id", workspace_id)
    .gte("generated_for_date", sinceIso);
  const freq = new Map<string, number>();
  for (const row of data ?? []) {
    const snap = row.product_snapshot as { tags?: unknown } | null;
    if (!snap || !Array.isArray(snap.tags)) continue;
    for (const t of snap.tags) {
      const tag = (typeof t === "string" ? t : (t as { name?: string })?.name ?? "")
        .toLowerCase()
        .trim();
      if (!tag) continue;
      freq.set(tag, (freq.get(tag) ?? 0) + 1);
    }
  }
  return freq;
}

function tagPenalty(tags: string[], recent: Map<string, number>): number {
  // 0 = totally fresh, 1 = saturated. Sum of recency hits per tag, normalized
  // by 6 (about 2 days × 3 slots). Cap at 1.
  let sum = 0;
  for (const t of tags) {
    const k = t.toLowerCase().trim();
    sum += recent.get(k) ?? 0;
  }
  return Math.min(1, sum / 6);
}

/**
 * Pick a candidate from a ranked pool with anti-saturation scoring:
 *   score = rank_weight × (1 - tag_penalty) × deterministic_jitter
 * The jitter (FNV-style on workspace+date+slot) keeps the same workspace
 * picking the same item if everything else is equal, but breaks rank ties
 * across days.
 */
function variedPick<T extends { product_id: string; rank: number; tags: string[] }>(
  pool: T[],
  recentTags: Map<string, number>,
  workspace_id: string,
  date: string,
  slot: Slot
): T | null {
  if (pool.length === 0) return null;
  let h = 0x811c9dc5;
  const seed = `${workspace_id}|${date}|${slot}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let best: T | null = null;
  let bestScore = -Infinity;
  pool.forEach((p, i) => {
    const rankWeight = 1 / Math.log2(p.rank + 2); // 1.0, 0.63, 0.5, 0.43...
    const freshness = 1 - tagPenalty(p.tags, recentTags);
    const jitter = 0.85 + (((h ^ i) >>> 0) % 1000) / 1000 / 6.6; // 0.85..1.0
    const score = rankWeight * freshness * jitter;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  });
  return best;
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
  settings: EmailTemplateSettings,
  exclude_ids: Set<string> = new Set(),
  date?: string
): Promise<PickResult> {
  // Two GA4 windows blended: the configured lookback (volume signal) and a
  // 7-day recency window. Items strong in BOTH bubble up; items strong only
  // in the long window (declining) sink.
  let scoreById: Record<string, number> = {};
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const longStart = new Date(
      Date.now() - settings.bestseller_lookback_days * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    const recentStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [longReport, recentReport] = await Promise.all([
      getGA4Report({
        startDate: longStart,
        endDate,
        dimensions: ["itemId"],
        metrics: ["itemPurchaseQuantity"],
        limit: 50,
        orderBy: { metric: "itemPurchaseQuantity", desc: true },
      }),
      getGA4Report({
        startDate: recentStart,
        endDate,
        dimensions: ["itemId"],
        metrics: ["itemPurchaseQuantity"],
        limit: 50,
        orderBy: { metric: "itemPurchaseQuantity", desc: true },
      }),
    ]);

    for (const r of longReport?.rows ?? []) {
      const id = String(r.dimensions?.itemId ?? "");
      if (id) scoreById[id] = (scoreById[id] ?? 0) + Number(r.metrics?.itemPurchaseQuantity ?? 0);
    }
    // Recent window weighted 1.5x — boost products trending RIGHT NOW.
    for (const r of recentReport?.rows ?? []) {
      const id = String(r.dimensions?.itemId ?? "");
      if (id) scoreById[id] = (scoreById[id] ?? 0) + 1.5 * Number(r.metrics?.itemPurchaseQuantity ?? 0);
    }
  } catch (err) {
    console.error("[email-templates/picker] pickBestseller GA4 failed:", (err as Error).message);
    return { product: null, reason: "no_ga4" };
  }

  const ranked = Object.entries(scoreById)
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);
  if (ranked.length === 0) return { product: null, reason: "no_candidate" };

  // 21-day per-slot cooldown + 7-day cross-slot dedupe.
  const usedSlot = await recentlyUsedProductIds(workspace_id, 1, 21);
  const usedAny = await recentlyUsedAcrossSlots(workspace_id, 7);
  const candidateIds = ranked
    .slice(0, 25)
    .filter((id) => !usedSlot.has(id) && !usedAny.has(id) && !exclude_ids.has(id));
  if (candidateIds.length === 0) return { product: null, reason: "all_recently_used" };

  const shelf = await fetchShelf(workspace_id, { ids: candidateIds });
  if (shelf.length === 0) return { product: null, reason: "no_shelf_data" };

  const byId = new Map(shelf.map((r) => [r.product_id, r]));
  const recentTags = await recentTagFrequency(workspace_id, 7);
  const pool = candidateIds
    .map((id, idx) => {
      const r = byId.get(id);
      if (!r) return null;
      const snap = toSnapshot(r);
      return { product_id: r.product_id, rank: idx, tags: snap.tags ?? [], row: r };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 12);

  const winner = variedPick(pool, recentTags, workspace_id, date ?? new Date().toISOString().slice(0, 10), 1);
  if (!winner) return { product: null, reason: "no_candidate" };
  return { product: toSnapshot(winner.row) };
}

export async function pickSlowmoving(
  workspace_id: string,
  settings: EmailTemplateSettings,
  exclude_ids: Set<string> = new Set(),
  date?: string
): Promise<PickResult> {
  // Candidates: every active in-stock product. The "slow-moving" signal is
  // GA4 sales (≤ slowmoving_max_sales over the lookback) — not catalog age.
  // The created_at filter was a proxy that caused false negatives on workspaces
  // whose shelf_products mirror was synced recently.
  const shelf = await fetchShelf(workspace_id, {});
  if (shelf.length === 0) return { product: null, reason: "no_shelf_data" };

  // Sales per product from GA4 over the slowmoving lookback window
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

  // 30-day per-slot cooldown for slowmoving (longer than bestseller because
  // the slow pool naturally rotates less, and we don't want to keep blasting
  // the same item every other week with a discount).
  const usedSlot = await recentlyUsedProductIds(workspace_id, 2, 30);
  const usedAny = await recentlyUsedAcrossSlots(workspace_id, 7);

  type Scored = { row: ShelfRow; sales: number };
  const eligible: Scored[] = shelf
    .filter(
      (r) =>
        !usedSlot.has(r.product_id) &&
        !usedAny.has(r.product_id) &&
        !exclude_ids.has(r.product_id)
    )
    .map((row) => ({ row, sales: salesById[row.product_id] ?? 0 }))
    .filter((x) => x.sales <= settings.slowmoving_max_sales);

  if (eligible.length === 0) {
    return { product: null, reason: usedSlot.size > 0 ? "all_recently_used" : "no_candidate" };
  }

  // Lower sales = higher base score. Then apply tag-cooldown variety + jitter.
  eligible.sort((a, b) => a.sales - b.sales);
  const recentTags = await recentTagFrequency(workspace_id, 14);
  const pool = eligible.slice(0, 15).map((x, idx) => ({
    product_id: x.row.product_id,
    rank: idx,
    tags: toSnapshot(x.row).tags ?? [],
    row: x.row,
  }));
  const winner = variedPick(pool, recentTags, workspace_id, date ?? new Date().toISOString().slice(0, 10), 2);
  if (!winner) return { product: null, reason: "no_candidate" };
  return { product: toSnapshot(winner.row) };
}

export async function pickNewarrival(
  workspace_id: string,
  settings: EmailTemplateSettings,
  exclude_ids: Set<string> = new Set(),
  date?: string
): Promise<PickResult> {
  const since = new Date(
    Date.now() - settings.newarrival_lookback_days * 24 * 60 * 60 * 1000
  ).toISOString();
  const shelf = await fetchShelf(workspace_id, { created_after_iso: since });
  if (shelf.length === 0) return { product: null, reason: "no_candidate" };

  // 21-day per-slot + 7-day cross-slot cooldown.
  const usedSlot = await recentlyUsedProductIds(workspace_id, 3, 21);
  const usedAny = await recentlyUsedAcrossSlots(workspace_id, 7);
  const eligible = shelf
    .filter(
      (r) =>
        !usedSlot.has(r.product_id) &&
        !usedAny.has(r.product_id) &&
        !exclude_ids.has(r.product_id)
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (eligible.length === 0) return { product: null, reason: "all_recently_used" };

  // Top 12 freshest, then variety pick (penalizes repeating tag clusters).
  const recentTags = await recentTagFrequency(workspace_id, 14);
  const pool = eligible.slice(0, 12).map((row, idx) => ({
    product_id: row.product_id,
    rank: idx,
    tags: toSnapshot(row).tags ?? [],
    row,
  }));
  const winner = variedPick(pool, recentTags, workspace_id, date ?? new Date().toISOString().slice(0, 10), 3);
  if (!winner) return { product: null, reason: "no_candidate" };
  return { product: toSnapshot(winner.row) };
}

/**
 * Picks up to N secondary products to render in the email grid below the hero.
 * Strategy: top-of-shelf (active + in_stock) ordered by created_at desc, excluding
 * the primary product and anything else already in `exclude_ids` (e.g. siblings
 * picked for other slots today, or recently used).
 */
export async function pickRelatedProducts(
  workspace_id: string,
  exclude_ids: Set<string>,
  limit = 3
): Promise<ProductSnapshot[]> {
  const shelf = await fetchShelf(workspace_id, {});
  return shelf
    .filter((r) => !exclude_ids.has(r.product_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map(toSnapshot);
}
