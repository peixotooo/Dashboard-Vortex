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
  /** Populated by shelf-catalog-sync (migration-030). Used downstream
   *  for category-penalty (anti-repetition) and personalization. */
  category?: string | null;
  sku?: string | null;
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
 * Recent-rotation context. Bundles two things the picker uses to avoid
 * saturation:
 *   - `tagFreq`: how often each product TAG appeared in the last N days
 *     of slots (legacy signal — finer-grained but noisy)
 *   - `categoryFreq`: how often each product CATEGORY appeared. Coarser
 *     and what users actually feel ("calça → calça → calça" is repetition
 *     even with different tags)
 *   - `totalSlots`: total #slots considered, so penalties can be
 *     normalized as a fraction of the rotation
 */
interface RotationContext {
  tagFreq: Map<string, number>;
  categoryFreq: Map<string, number>;
  totalSlots: number;
}

async function recentRotationContext(
  workspace_id: string,
  days: number
): Promise<RotationContext> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("product_snapshot")
    .eq("workspace_id", workspace_id)
    .gte("generated_for_date", sinceIso);
  const tagFreq = new Map<string, number>();
  const categoryFreq = new Map<string, number>();
  let totalSlots = 0;
  for (const row of data ?? []) {
    const snap = row.product_snapshot as
      | { tags?: unknown; category?: unknown }
      | null;
    if (!snap) continue;
    totalSlots += 1;
    if (Array.isArray(snap.tags)) {
      for (const t of snap.tags) {
        const tag = (typeof t === "string" ? t : (t as { name?: string })?.name ?? "")
          .toLowerCase()
          .trim();
        if (!tag) continue;
        tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
      }
    }
    if (typeof snap.category === "string") {
      const cat = snap.category.toLowerCase().trim();
      if (cat) categoryFreq.set(cat, (categoryFreq.get(cat) ?? 0) + 1);
    }
  }
  return { tagFreq, categoryFreq, totalSlots };
}

/**
 * Combined freshness penalty (0 fresh → 1 saturated). Two components
 * blended:
 *   - Tag overlap with recent rotation (cheap, granular)
 *   - Category overlap normalized by total recent slots, weighted by
 *     `categoryWeight` (default 0.5). Categories matter more —
 *     calça-calça-calça is repetition even with different tags.
 */
function freshnessPenalty(
  tags: string[],
  category: string | undefined,
  rotation: RotationContext,
  categoryWeight: number
): number {
  // Tag component: same as legacy, normalized by ~6 (2 days × 3 slots).
  let tagSum = 0;
  for (const t of tags) {
    tagSum += rotation.tagFreq.get(t.toLowerCase().trim()) ?? 0;
  }
  const tagP = Math.min(1, tagSum / 6);

  // Category component: fraction of recent slots that were the same
  // category, capped at 0.7 so a candidate with the most-used category
  // can still win when nothing fresher exists.
  let catP = 0;
  if (category && rotation.totalSlots > 0) {
    const cat = category.toLowerCase().trim();
    const count = rotation.categoryFreq.get(cat) ?? 0;
    catP = Math.min(0.7, count / rotation.totalSlots);
  }

  // Blend. categoryWeight controls how much the category dominates;
  // 0 = legacy tag-only behavior, 1 = category-only.
  const w = Math.max(0, Math.min(1, categoryWeight));
  return Math.min(1, tagP * (1 - w) + catP * w * 1.4);
}

/**
 * Aggregates real qty-sold-per-SKU from `crm_vendas.items` over the last
 * `lookbackDays`. Used to cross-validate GA4 bestseller signals — if
 * GA4 reports strong qty for a product but CRM has barely any receipts
 * for the matching SKU, the picker damps the score (sign of GA4 ghost
 * tracking, e.g. mis-tagged item events).
 *
 * Returns a Map<sku_lowercase, qty>. Best-effort: if `items` doesn't
 * carry SKU (older webhook captures), the entry just won't be there
 * and the caller treats it as "no signal" (no damping).
 */
async function fetchCrmSalesByLookback(
  workspace_id: string,
  lookbackDays: number
): Promise<Map<string, number>> {
  const sinceIso = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("crm_vendas")
    .select("items")
    .eq("workspace_id", workspace_id)
    .gte("data_compra", sinceIso)
    .limit(5000);
  const out = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ items: unknown }>) {
    const items = Array.isArray(row.items) ? row.items : [];
    for (const item of items as Array<{ sku?: string | null; quantity?: number }>) {
      const sku = item.sku?.trim().toLowerCase();
      if (!sku) continue;
      const q = Math.max(1, Number(item.quantity ?? 1));
      out.set(sku, (out.get(sku) ?? 0) + q);
    }
  }
  return out;
}

/** Quick stat used to decide whether cooldown tiers are realistic. If
 *  the eligible pool after a tier is too small relative to the catalog,
 *  the picker auto-relaxes to the next tier. */
async function catalogAwareness(workspace_id: string): Promise<{
  totalActive: number;
}> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("shelf_products")
    .select("product_id", { count: "exact", head: true })
    .eq("workspace_id", workspace_id)
    .eq("active", true)
    .eq("in_stock", true);
  return { totalActive: count ?? 0 };
}

/**
 * Apply cooldown filters in tiers. Walks tiers in order; first tier that
 * leaves enough candidates wins. Last tier should be {0,0} so we never
 * return empty.
 *
 * Auto-relax: previously a tier was accepted as soon as ≥1 candidate
 * survived, which let a workspace with a small catalog get pinned to a
 * single product (cooldown at 21d → only 2 products survive → same
 * winner every day for 3 weeks). Now we require the surviving pool to
 * be at least `relaxThreshold × catalogSize` (default 30%); below that
 * we step to the next, looser tier.
 */
async function tieredFilter(
  candidateIds: string[],
  workspace_id: string,
  slot: Slot,
  tiers: Array<{ perSlotDays: number; crossSlotDays: number }>,
  exclude_ids: Set<string>,
  options: { catalogSize?: number; relaxThreshold?: number } = {}
): Promise<string[]> {
  const catalogSize = options.catalogSize ?? candidateIds.length;
  const minPool = Math.max(
    1,
    Math.floor(catalogSize * (options.relaxThreshold ?? 0.3))
  );
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const usedSlot =
      tier.perSlotDays > 0
        ? await recentlyUsedProductIds(workspace_id, slot, tier.perSlotDays)
        : new Set<string>();
    const usedAny =
      tier.crossSlotDays > 0
        ? await recentlyUsedAcrossSlots(workspace_id, tier.crossSlotDays)
        : new Set<string>();
    const filtered = candidateIds.filter(
      (id) => !usedSlot.has(id) && !usedAny.has(id) && !exclude_ids.has(id)
    );
    // Last tier always accepts (better stale repeat than empty cron).
    if (i === tiers.length - 1) return filtered;
    if (filtered.length >= minPool) return filtered;
  }
  return [];
}

/**
 * Pick a candidate from a ranked pool with anti-saturation scoring +
 * epsilon-greedy exploration.
 *   score = rank_weight × (1 - freshness_penalty) × deterministic_jitter
 *
 * Two changes vs legacy `variedPick`:
 *   1. Freshness penalty considers BOTH tag and category overlap (and
 *      categories are normalized by total recent slots — see
 *      freshnessPenalty), so "calça → calça" gets penalized even when
 *      the tags differ.
 *   2. With prob `explorationRate` (default 0.15) we don't pick the
 *      argmax — instead we sample from the top-5 weighted by score.
 *      This breaks the always-the-same-product trap on small catalogs
 *      where the top item dominates after dedup.
 *
 * The deterministic jitter and exploration sampling both seed off
 * (workspace, date, slot) — same workspace+day+slot still produces the
 * same pick (idempotent cron), but the jitter shifts day-by-day.
 */
function variedPick<
  T extends {
    product_id: string;
    rank: number;
    tags: string[];
    category?: string;
  },
>(
  pool: T[],
  rotation: RotationContext,
  workspace_id: string,
  date: string,
  slot: Slot,
  options: { categoryWeight?: number; explorationRate?: number } = {}
): T | null {
  if (pool.length === 0) return null;
  const categoryWeight = options.categoryWeight ?? 0.5;
  const explorationRate = Math.max(0, Math.min(1, options.explorationRate ?? 0.15));

  // FNV-1a seed off the deterministic context.
  let h = 0x811c9dc5;
  const seed = `${workspace_id}|${date}|${slot}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  // Compute scores once.
  const scored = pool.map((p, i) => {
    const rankWeight = 1 / Math.log2(p.rank + 2);
    const freshness = 1 - freshnessPenalty(p.tags, p.category, rotation, categoryWeight);
    const jitter = 0.85 + (((h ^ i) >>> 0) % 1000) / 1000 / 6.6;
    return { item: p, score: rankWeight * Math.max(0.05, freshness) * jitter };
  });
  scored.sort((a, b) => b.score - a.score);

  // Coin-flip on jitter to decide explore vs exploit.
  const exploreRoll = (h % 1000) / 1000;
  if (exploreRoll < explorationRate && scored.length > 1) {
    // Weighted sample from the top-5 (or fewer) by score.
    const top = scored.slice(0, Math.min(5, scored.length));
    const totalWeight = top.reduce((s, x) => s + Math.max(x.score, 0.0001), 0);
    let target = ((h * 1664525 + 1013904223) >>> 0) % 1000;
    target = (target / 1000) * totalWeight;
    let acc = 0;
    for (const cand of top) {
      acc += Math.max(cand.score, 0.0001);
      if (acc >= target) return cand.item;
    }
    return top[top.length - 1].item;
  }
  return scored[0].item;
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
    category: row.category ?? undefined,
    sku: row.sku ?? undefined,
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
    .select(
      "product_id, name, price, sale_price, image_url, product_url, tags, created_at, category, sku"
    )
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
  // Multi-component bestseller score (Frente B). The legacy version
  // was just GA4 long(7d) × 1.0 + GA4 recent(7d) × 1.5 — a 7-day window
  // raw, so a transient hit could win. The new score blends volume,
  // revenue, momentum, freshness and stock health, smoothed with a
  // Bayesian floor to keep noise from dominating, and optionally
  // cross-validated against crm_vendas.items.sku.
  //
  //   score = log(1 + qty)        × 0.35
  //         + log(1 + revenue)    × bestseller_revenue_weight (default 0.25)
  //         + momentum_norm       × 0.20
  //         + freshness_bonus     × 0.10
  //         + stock_health        × 0.10
  //         × bayes_smoothing
  //         × crm_validation_factor (1.0 unless settings.crm_validation_enabled)
  let qtyById: Record<string, number> = {};
  let revenueById: Record<string, number> = {};
  let momentumById: Record<string, number> = {};
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const longStart = new Date(
      Date.now() - settings.bestseller_lookback_days * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    const momentumHours = Math.max(6, Math.min(168, settings.momentum_window_hours));
    const momentumStart = new Date(
      Date.now() - momentumHours * 60 * 60 * 1000
    ).toISOString().slice(0, 10);

    const [longReport, momentumReport] = await Promise.all([
      getGA4Report({
        startDate: longStart,
        endDate,
        dimensions: ["itemId"],
        // itemRevenue gives us monetary signal alongside qty — a high-
        // ticket item with fewer units can still beat a cheaper
        // lookalike on score.
        metrics: ["itemPurchaseQuantity", "itemRevenue"],
        limit: 100,
        orderBy: { metric: "itemPurchaseQuantity", desc: true },
      }),
      getGA4Report({
        startDate: momentumStart,
        endDate,
        dimensions: ["itemId"],
        metrics: ["itemPurchaseQuantity"],
        limit: 100,
        orderBy: { metric: "itemPurchaseQuantity", desc: true },
      }),
    ]);

    for (const r of longReport?.rows ?? []) {
      const id = String(r.dimensions?.itemId ?? "");
      if (!id) continue;
      qtyById[id] = Number(r.metrics?.itemPurchaseQuantity ?? 0);
      revenueById[id] = Number(r.metrics?.itemRevenue ?? 0);
    }
    for (const r of momentumReport?.rows ?? []) {
      const id = String(r.dimensions?.itemId ?? "");
      if (id) momentumById[id] = Number(r.metrics?.itemPurchaseQuantity ?? 0);
    }
  } catch (err) {
    console.error("[email-templates/picker] pickBestseller GA4 failed:", (err as Error).message);
    return { product: null, reason: "no_ga4" };
  }

  if (Object.keys(qtyById).length === 0) {
    return { product: null, reason: "no_candidate" };
  }

  // Optional CRM cross-validation. Pulls SKU-level qty from crm_vendas
  // for the same lookback. If GA4 says top but CRM disagrees by > 50%,
  // the candidate's score gets damped — sign of GA4 ghost tracking.
  let crmQtyBySku: Map<string, number> | null = null;
  if (settings.crm_validation_enabled) {
    try {
      crmQtyBySku = await fetchCrmSalesByLookback(
        workspace_id,
        settings.bestseller_lookback_days
      );
    } catch (err) {
      console.warn(
        "[email-templates/picker] CRM cross-validation skipped:",
        (err as Error).message
      );
    }
  }

  // Pre-fetch shelf rows for all candidates so we can read sku, category,
  // created_at, in_stock during scoring.
  const candidateGa4Ids = Object.keys(qtyById);
  const shelfPre = await fetchShelf(workspace_id, { ids: candidateGa4Ids });
  const shelfByIdPre = new Map(shelfPre.map((r) => [r.product_id, r]));

  // Compute baseline daily qty from the full lookback for momentum
  // normalization. Avoid division by zero with a 0.5/day floor.
  const lookbackDays = Math.max(7, settings.bestseller_lookback_days);
  const momentumHoursVal = Math.max(6, Math.min(168, settings.momentum_window_hours));

  // Bayesian prior — global average qty across all candidates. Smooths
  // out one-off spikes (a single 5-unit order) when the catalog has a
  // big stable seller in the same period.
  const allQty = Object.values(qtyById);
  const priorMean =
    allQty.length > 0 ? allQty.reduce((s, x) => s + x, 0) / allQty.length : 0;
  const PRIOR_STRENGTH = 10;

  const NOW = Date.now();
  const FRESHNESS_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
  const revenueWeight = Math.max(
    0,
    Math.min(1, settings.bestseller_revenue_weight)
  );

  const scoreById: Record<string, number> = {};
  for (const id of candidateGa4Ids) {
    const qty = qtyById[id] ?? 0;
    const revenue = revenueById[id] ?? 0;
    const momentumQty = momentumById[id] ?? 0;
    const row = shelfByIdPre.get(id);

    // Bayesian smoothing on qty (prior mean as if every product had
    // PRIOR_STRENGTH "phantom" days of average sales).
    const qtySmoothed = (qty * lookbackDays + priorMean * PRIOR_STRENGTH) /
      (lookbackDays + PRIOR_STRENGTH);

    // Momentum: sales-per-hour during the recent window relative to
    // sales-per-hour of the full lookback. >1.0 = trending up, <1.0 =
    // declining. Capped at 3.0 to stop one viral day dominating.
    const baselinePerHour = qty / Math.max(1, lookbackDays * 24);
    const momentumPerHour = momentumQty / Math.max(1, momentumHoursVal);
    const momentumRaw =
      baselinePerHour > 0
        ? momentumPerHour / baselinePerHour
        : momentumPerHour > 0
          ? 1.5
          : 0;
    const momentum = Math.min(3, momentumRaw);

    // Freshness: linear decay from 1.0 (just created) to 0.0 (>60d).
    let freshness = 0;
    if (row?.created_at) {
      const ageMs = NOW - new Date(row.created_at).getTime();
      if (ageMs >= 0) freshness = Math.max(0, 1 - ageMs / FRESHNESS_WINDOW_MS);
    }

    // Stock health: 1.0 if in_stock with healthy supply, 0.3 if barely
    // available, 0 if out. We don't have per-row stock count without
    // an extra query, so we approximate: ShelfRow has in_stock boolean
    // already filtered in fetchShelf, so anything we got back is at
    // least available. Future improvement: fetch stock count and grade
    // against settings.min_stock_bestseller.
    const stockHealth = row ? 1 : 0.3;

    // CRM cross-validation: damp the score when GA4 qty wildly
    // overstates real receipts.
    let crmFactor = 1;
    if (crmQtyBySku && row?.sku) {
      const crmQty = crmQtyBySku.get(row.sku.toLowerCase()) ?? 0;
      if (qty > 0 && crmQty / qty < 0.5) {
        // GA4 reports more than 2× what CRM saw. Damp.
        crmFactor = Math.max(0.4, crmQty / qty);
      }
    }

    const score =
      (Math.log1p(qtySmoothed) * 0.35 +
        Math.log1p(revenue) * revenueWeight +
        momentum * 0.2 +
        freshness * 0.1 +
        stockHealth * 0.1) *
      crmFactor;

    if (score > 0) scoreById[id] = score;
  }

  const ranked = Object.entries(scoreById)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);
  if (ranked.length === 0) return { product: null, reason: "no_candidate" };

  // Tiered cooldown with auto-relax. Cascade is now finer-grained
  // (21+7 → 14+3 → 7+1 → 0+0) so the cliff between "strict cooldown"
  // and "no cooldown" is gentler. Auto-relax kicks if a tier leaves
  // less than auto_relax_threshold × catalog_size candidates — small
  // catalogs no longer pin themselves to 1-2 products for weeks.
  const { totalActive } = await catalogAwareness(workspace_id);
  const candidateIds = await tieredFilter(
    ranked.slice(0, 25),
    workspace_id,
    1,
    [
      { perSlotDays: 21, crossSlotDays: 7 },
      { perSlotDays: 14, crossSlotDays: 3 },
      { perSlotDays: 7, crossSlotDays: 1 },
      { perSlotDays: 0, crossSlotDays: 0 },
    ],
    exclude_ids,
    { catalogSize: totalActive, relaxThreshold: settings.auto_relax_threshold }
  );
  if (candidateIds.length === 0) return { product: null, reason: "all_recently_used" };

  const shelf = await fetchShelf(workspace_id, { ids: candidateIds });
  if (shelf.length === 0) return { product: null, reason: "no_shelf_data" };

  const byId = new Map(shelf.map((r) => [r.product_id, r]));
  // Look back 14d for rotation context — catches week-over-week
  // saturation, not just last few days. categoryFreq pulls double duty
  // alongside tagFreq inside freshnessPenalty.
  const rotation = await recentRotationContext(workspace_id, 14);
  const pool = candidateIds
    .map((id, idx) => {
      const r = byId.get(id);
      if (!r) return null;
      const snap = toSnapshot(r);
      return {
        product_id: r.product_id,
        rank: idx,
        tags: snap.tags ?? [],
        category: snap.category,
        row: r,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 12);

  const winner = variedPick(
    pool,
    rotation,
    workspace_id,
    date ?? new Date().toISOString().slice(0, 10),
    1,
    {
      categoryWeight: settings.category_penalty_weight,
      explorationRate: settings.exploration_rate,
    }
  );
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

  // Pre-filter by sales threshold first (the actual slowmoving signal),
  // then tier-down on cooldowns so we never return empty just because the
  // strict 30-day window saturated.
  const slowOnly = shelf
    .map((row) => ({ row, sales: salesById[row.product_id] ?? 0 }))
    .filter((x) => x.sales <= settings.slowmoving_max_sales);
  const slowIds = slowOnly.map((x) => x.row.product_id);

  const { totalActive } = await catalogAwareness(workspace_id);
  const filteredIds = await tieredFilter(
    slowIds,
    workspace_id,
    2,
    [
      { perSlotDays: 30, crossSlotDays: 7 },
      { perSlotDays: 14, crossSlotDays: 3 },
      { perSlotDays: 7, crossSlotDays: 1 },
      { perSlotDays: 0, crossSlotDays: 0 },
    ],
    exclude_ids,
    { catalogSize: totalActive, relaxThreshold: settings.auto_relax_threshold }
  );
  type Scored = { row: ShelfRow; sales: number };
  const eligible: Scored[] = slowOnly.filter((x) => filteredIds.includes(x.row.product_id));

  if (eligible.length === 0) {
    return { product: null, reason: "no_candidate" };
  }

  // Lower sales = higher base score. Then apply combined freshness +
  // epsilon-greedy exploration via the new variedPick.
  eligible.sort((a, b) => a.sales - b.sales);
  const rotation = await recentRotationContext(workspace_id, 14);
  const pool = eligible.slice(0, 15).map((x, idx) => {
    const snap = toSnapshot(x.row);
    return {
      product_id: x.row.product_id,
      rank: idx,
      tags: snap.tags ?? [],
      category: snap.category,
      row: x.row,
    };
  });
  const winner = variedPick(
    pool,
    rotation,
    workspace_id,
    date ?? new Date().toISOString().slice(0, 10),
    2,
    {
      categoryWeight: settings.category_penalty_weight,
      explorationRate: settings.exploration_rate,
    }
  );
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

  // Newarrival pool is naturally small (just last N days of adds), so
  // the relax threshold matters less here — but the finer-grained
  // cascade still helps prevent the same "novidade" looping daily.
  const allIds = shelf.map((r) => r.product_id);
  const { totalActive } = await catalogAwareness(workspace_id);
  const filteredIds = await tieredFilter(
    allIds,
    workspace_id,
    3,
    [
      { perSlotDays: 21, crossSlotDays: 7 },
      { perSlotDays: 14, crossSlotDays: 3 },
      { perSlotDays: 7, crossSlotDays: 1 },
      { perSlotDays: 0, crossSlotDays: 0 },
    ],
    exclude_ids,
    { catalogSize: totalActive, relaxThreshold: settings.auto_relax_threshold }
  );
  const filteredSet = new Set(filteredIds);
  const eligible = shelf
    .filter((r) => filteredSet.has(r.product_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (eligible.length === 0) return { product: null, reason: "no_candidate" };

  // Top 12 freshest, then combined freshness + epsilon-greedy.
  const rotation = await recentRotationContext(workspace_id, 14);
  const pool = eligible.slice(0, 12).map((row, idx) => {
    const snap = toSnapshot(row);
    return {
      product_id: row.product_id,
      rank: idx,
      tags: snap.tags ?? [],
      category: snap.category,
      row,
    };
  });
  const winner = variedPick(
    pool,
    rotation,
    workspace_id,
    date ?? new Date().toISOString().slice(0, 10),
    3,
    {
      categoryWeight: settings.category_penalty_weight,
      explorationRate: settings.exploration_rate,
    }
  );
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
