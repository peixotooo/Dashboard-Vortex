import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";
import {
  extractPromoTagModalMetadata,
  normalizePromoTagPages,
} from "@/lib/promo-tags/modal-metadata";
import {
  extractPromoTagComboTiers,
  type PromoComboTiersConfig,
} from "@/lib/promo-tags/combo-tiers";

// --- Popularity cache: GA4 itemsViewed last 30d, normalized 0-1 (per workspace) ---

interface SalesSignal {
  units: number;
  revenue: number;
  salesScore: number; // 0..1 percentile by recent revenue
  abcTier: "A" | "B" | "C";
}

interface PopularityCacheEntry {
  scores: Map<string, number>; // product_id → 0..1 (log-scaled)
  scoresByName: Map<string, number>; // normalized name → 0..1 (fallback when itemId is missing)
  expiresAt: number;
}
const POPULARITY_CACHE = new Map<string, PopularityCacheEntry>();
const POPULARITY_TTL_MS = 60 * 60 * 1000; // 1h

function normalizeName(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

async function getPopularityScores(workspaceId: string): Promise<PopularityCacheEntry> {
  const cached = POPULARITY_CACHE.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const empty: PopularityCacheEntry = {
    scores: new Map(),
    scoresByName: new Map(),
    expiresAt: Date.now() + POPULARITY_TTL_MS,
  };

  if (!process.env.GA4_PROPERTY_ID) {
    POPULARITY_CACHE.set(workspaceId, empty);
    return empty;
  }

  try {
    // Pull both itemId and itemName so we can fall back when one is missing
    const [byId, byName] = await Promise.all([
      getGA4Report({
        dimensions: ["itemId"],
        metrics: ["itemsViewed"],
        datePreset: "last_30d",
        limit: 2000,
      }).catch(() => ({ rows: [] })),
      getGA4Report({
        dimensions: ["itemName"],
        metrics: ["itemsViewed"],
        datePreset: "last_30d",
        limit: 2000,
      }).catch(() => ({ rows: [] })),
    ]);

    function buildMap(rows: Array<{ dimensions: Record<string, string>; metrics: Record<string, number> }>, dimKey: string, normalize?: (s: string) => string) {
      const raw: Array<{ key: string; views: number }> = [];
      for (const r of rows) {
        const k = r.dimensions[dimKey];
        const v = Number(r.metrics.itemsViewed) || 0;
        if (k && v > 0) raw.push({ key: normalize ? normalize(k) : k, views: v });
      }
      if (raw.length === 0) return new Map<string, number>();
      // Percentile rank — gives a uniform 0..1 distribution. Log scaling
      // compressed too many products into the same mid-range, making most
      // PDPs show similar viewer counts. Percentile spreads them evenly.
      const sorted = [...raw].sort((a, b) => a.views - b.views);
      const map = new Map<string, number>();
      sorted.forEach((r, i) => {
        const pct = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
        map.set(r.key, pct);
      });
      return map;
    }

    empty.scores = buildMap(byId.rows || [], "itemId");
    empty.scoresByName = buildMap(byName.rows || [], "itemName", normalizeName);
  } catch (e) {
    console.error("[PromoTags] GA4 popularity fetch failed:", e);
  }

  POPULARITY_CACHE.set(workspaceId, empty);
  return empty;
}

function lookupPopularity(
  product: ShelfProductRow,
  pop: PopularityCacheEntry
): number {
  const byId = pop.scores.get(product.product_id);
  if (typeof byId === "number") return byId;
  const byName = pop.scoresByName.get(normalizeName(product.name || ""));
  if (typeof byName === "number") return byName;
  return -1; // unknown — caller falls back to tag heuristic
}

interface SalesSignalCacheEntry {
  signals: Map<string, SalesSignal>;
  expiresAt: number;
}

const SALES_SIGNAL_CACHE = new Map<string, SalesSignalCacheEntry>();
const SALES_SIGNAL_TTL_MS = 60 * 60 * 1000; // 1h

function normalizeSku(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

async function getRecentSalesSignals(
  workspaceId: string,
  products: ShelfProductRow[]
): Promise<Map<string, SalesSignal>> {
  const cached = SALES_SIGNAL_CACHE.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.signals;

  const byId = new Map<string, ShelfProductRow>();
  const bySku = new Map<string, ShelfProductRow>();
  const byName = new Map<string, ShelfProductRow>();
  for (const p of products) {
    byId.set(p.product_id, p);
    if (p.sku) bySku.set(normalizeSku(p.sku), p);
    byName.set(normalizeName(p.name), p);
  }

  const agg = new Map<string, { units: number; revenue: number }>();
  for (const p of products) agg.set(p.product_id, { units: 0, revenue: 0 });

  const admin = createAdminClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("items")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", since.toISOString())
      .not("items", "is", null)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[PromoTags] recent sales signal fetch failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ items: unknown }>) {
      const items = Array.isArray(row.items) ? row.items : [];
      for (const item of items as Array<Record<string, unknown>>) {
        const reference = normalizeSku(item.reference);
        const sku = normalizeSku(item.sku);
        const baseSku = sku.split(/[-_]/)[0] || "";
        const name = normalizeName(String(item.name || item.product_name || ""));
        const product =
          (reference && bySku.get(reference)) ||
          (reference && byId.get(reference)) ||
          (sku && bySku.get(sku)) ||
          (baseSku && bySku.get(baseSku)) ||
          (baseSku && byId.get(baseSku)) ||
          (name && byName.get(name));
        if (!product) continue;

        const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
        const revenue = Math.max(0, Number(item.total ?? item.price ?? 0) || 0);
        const current = agg.get(product.product_id) || { units: 0, revenue: 0 };
        current.units += quantity;
        current.revenue += revenue;
        agg.set(product.product_id, current);
      }
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  const sorted = Array.from(agg.entries()).sort((a, b) => a[1].revenue - b[1].revenue);
  const revenuePct = new Map<string, number>();
  sorted.forEach(([pid], i) => {
    revenuePct.set(pid, sorted.length > 1 ? i / (sorted.length - 1) : 0.5);
  });

  const byRevenueDesc = Array.from(agg.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  const totalRevenue = byRevenueDesc.reduce((sum, [, row]) => sum + row.revenue, 0);
  const tierByProduct = new Map<string, "A" | "B" | "C">();
  let cumulative = 0;
  for (const [pid, row] of byRevenueDesc) {
    if (totalRevenue <= 0) {
      tierByProduct.set(pid, "C");
      continue;
    }
    cumulative += row.revenue;
    const pct = cumulative / totalRevenue;
    tierByProduct.set(pid, pct <= 0.5 ? "A" : pct <= 0.8 ? "B" : "C");
  }

  const signals = new Map<string, SalesSignal>();
  for (const [pid, row] of agg.entries()) {
    signals.set(pid, {
      units: row.units,
      revenue: row.revenue,
      salesScore: revenuePct.get(pid) ?? 0,
      abcTier: tierByProduct.get(pid) || "C",
    });
  }

  SALES_SIGNAL_CACHE.set(workspaceId, {
    signals,
    expiresAt: Date.now() + SALES_SIGNAL_TTL_MS,
  });
  return signals;
}

export type BadgeType = "static" | "cashback" | "viewers" | "coupon_countdown";
export type BadgePlacement = "auto" | "pdp_price" | "pdp_above_buy" | "card_overlay";

export interface PromoTagRule {
  badge_text: string;
  badge_bg_color: string;
  badge_text_color: string;
  badge_font_size: string;
  badge_border_radius: string;
  badge_position: string;
  badge_padding: string;
  badge_type: BadgeType;
  badge_placement: BadgePlacement;
  priority: number;
  show_on_pages?: string[];
  // Pre-computed per-product values (only present for dynamic badge types)
  cashback_value?: number;     // R$ this product earns in cashback
  viewers_baseline?: number;   // server-suggested live viewer count
  viewers_min?: number;
  viewers_max?: number;
  modal_title?: string | null;
  modal_body?: string | null;
  combo_tiers?: PromoComboTiersConfig;
  // Countdown coupon — emitted when an active coupon exists for this product
  coupon_code?: string;
  coupon_discount_pct?: number;
  coupon_expires_at?: string;  // ISO timestamp
}

interface ShelfProductRow {
  product_id: string;
  sku: string | null;
  tags: unknown;
  category: string | null;
  name: string;
  price: number | null;
  sale_price: number | null;
}

interface MatchesPayload {
  matches: Record<string, PromoTagRule[]>;
  cashback_percent: number;
}

/**
 * Brasilia-hour traffic multiplier curve derived from GA4 data
 * (Bulking last-90d aggregate). Used to make live-viewers feel real.
 */
function hourMultiplier(hourBRT: number): number {
  const curve = [
    0.12, 0.08, 0.06, 0.04, 0.04, 0.07,  // 0-5
    0.12, 0.22, 0.35, 0.50, 0.62, 0.68,  // 6-11
    0.72, 0.68, 0.62, 0.68, 0.76, 0.84,  // 12-17
    0.94, 1.00, 0.96, 0.86, 0.62, 0.35,  // 18-23
  ];
  return curve[hourBRT] ?? 0.5;
}

function currentHourBRT(): number {
  // BRT = UTC-3, no DST anymore
  const d = new Date();
  return (d.getUTCHours() + 21) % 24;
}

/**
 * Stable hash → number in [0,1) for a product_id, so jitter is consistent
 * across users for the same product (no wild swings between sessions).
 */
function productSeed(productId: string): number {
  let h = 2166136261;
  for (let i = 0; i < productId.length; i++) {
    h ^= productId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296; // 0..1
}

/**
 * Two-arg seed (product + extra) for a second deterministic dim — used to
 * shift each product slightly per day so the same SKU doesn't show the
 * same baseline today vs tomorrow.
 */
function combinedSeed(productId: string, salt: string): number {
  let h = 2166136261;
  const s = productId + "|" + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Per-day shift in [-1, 1] — same value across all products on a given day,
 * so the whole store's viewer counts gently rise on some days, drop on others.
 */
function dayShift(): number {
  // Brasilia date as YYYY-MM-DD (UTC-3, no DST)
  const d = new Date();
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  const day = brt.toISOString().slice(0, 10);
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h = (h ^ day.charCodeAt(i)) * 16777619;
  }
  return (((h >>> 0) % 2000) / 1000) - 1; // -1..+1
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function brtDateKey(): string {
  const d = new Date();
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  return brt.toISOString().slice(0, 10);
}

function computeViewersBaseline(
  product: ShelfProductRow,
  min: number,
  max: number,
  hourMult: number,
  popularityScore: number, // -1 if unknown, else 0..1 percentile rank from GA4
  salesSignal?: SalesSignal
): number {
  let rankWeight: number;
  if (popularityScore >= 0) {
    rankWeight = popularityScore;
  } else {
    const tagsArr =
      (product.tags as { vnda_tags?: Array<{ name?: string } | string> })?.vnda_tags ||
      (Array.isArray(product.tags) ? product.tags : []);
    // Unknown GA4 rows used to collapse into one middle-ish value, which made
    // PDPs look cloned. Use tags as a hint, then add a deterministic product
    // proxy so unknown products still spread across the range.
    rankWeight = 0.16 + productSeed(product.product_id) * 0.50;
    if (Array.isArray(tagsArr)) {
      const names = tagsArr.map((t) =>
        typeof t === "string" ? t.toLowerCase() : (t as { name?: string })?.name?.toLowerCase() || ""
      );
      if (names.includes("mais-vendidos") || names.includes("top-vendas") || names.includes("bestseller")) {
        rankWeight = 0.85;
      } else if (names.includes("lancamentos") || names.includes("destaque")) {
        rankWeight = 0.55;
      }
    }
  }

  if (salesSignal) {
    const salesScore = clamp01(salesSignal.salesScore);
    rankWeight = popularityScore >= 0
      ? popularityScore * 0.35 + salesScore * 0.65
      : rankWeight * 0.25 + salesScore * 0.75;

    if (salesSignal.units <= 0) {
      rankWeight = Math.min(rankWeight, 0.06);
    } else if (salesSignal.abcTier === "C") {
      rankWeight = Math.min(rankWeight, 0.20 + salesScore * 0.18);
    } else if (salesSignal.abcTier === "B") {
      rankWeight = Math.min(rankWeight, 0.52 + salesScore * 0.12);
    }
  }

  const seed = productSeed(product.product_id);
  // Per-day per-product seed — different number every day for the same SKU.
  const todaySeed = combinedSeed(product.product_id, brtDateKey());
  // Global day shift — moves the whole store up/down on a given day
  const dayJitter = dayShift();
  const volatilitySeed = combinedSeed(product.product_id, "viewer-volatility");

  const safeMin = Math.max(1, Math.floor(min));
  const safeMax = Math.max(safeMin + 1, Math.floor(max));
  const range = safeMax - safeMin;

  // Shape demand so the long tail stays visibly lower while best sellers can
  // reach the top end. Hour changes scale demand without flattening all SKUs
  // into the same middle band.
  const demand = Math.pow(clamp01(rankWeight), 1.9);
  const traffic = Math.pow(clamp(hourMult, 0.14, 1), 0.82);
  const productPersonality = (seed - 0.5) * 0.12;      // ±6%
  const dailyProductMove = (todaySeed - 0.5) * 0.10;   // ±5%
  const globalMove = dayJitter * 0.06;                 // ±6%
  const volatilityMove = (volatilitySeed - 0.5) * 0.06;// ±3%

  let ratio = clamp01(
    0.03 +
      (0.05 + demand * 0.78) * traffic +
      productPersonality +
      dailyProductMove +
      globalMove +
      volatilityMove
  );

  if (salesSignal) {
    const salesCap = salesSignal.units <= 0
      ? 0.18
      : salesSignal.abcTier === "C"
      ? 0.30
      : salesSignal.abcTier === "B"
      ? 0.56
      : 0.92;
    ratio = Math.min(ratio, salesCap);
  }

  return clamp(Math.round(safeMin + range * ratio), safeMin, safeMax);
}

function productMatchesTag(product: ShelfProductRow, tagName: string): boolean {
  const tags = product.tags;
  if (!tags || typeof tags !== "object") return false;
  const target = tagName.toLowerCase().trim();

  const obj = tags as Record<string, unknown>;
  const vndaTags = obj.vnda_tags;
  if (Array.isArray(vndaTags)) {
    return vndaTags.some((t) => {
      if (typeof t === "string") return t.toLowerCase().trim() === target;
      if (t && typeof t === "object" && "name" in t)
        return ((t as { name: string }).name || "").toLowerCase().trim() === target;
      return false;
    });
  }
  if (Array.isArray(tags)) {
    return (tags as unknown[]).some((t) => {
      if (typeof t === "string") return t.toLowerCase().trim() === target;
      if (t && typeof t === "object" && "name" in t)
        return ((t as { name: string }).name || "").toLowerCase().trim() === target;
      return false;
    });
  }
  return false;
}

export async function computePromoTagMatches(
  workspaceId: string
): Promise<MatchesPayload> {
  const admin = createAdminClient();

  // Workspace cashback %
  const { data: cb } = await admin
    .from("cashback_config")
    .select("percentage")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const cashbackPercent = cb?.percentage ? Number(cb.percentage) : 0;

  const { data: rawRules } = await admin
    .from("promo_tag_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .order("priority", { ascending: false });

  // Honor optional schedule window: starts_at / ends_at columns from
  // migration 065. A null bound means open-ended on that side.
  const nowMs = Date.now();
  const rules = (rawRules || []).filter((r) => {
    if (r.starts_at && new Date(r.starts_at).getTime() > nowMs) return false;
    if (r.ends_at && new Date(r.ends_at).getTime() <= nowMs) return false;
    return true;
  });

  if (rules.length === 0) {
    return { matches: {}, cashback_percent: cashbackPercent };
  }

  // Pre-fetch the full active product list once if any rule needs row data
  const needProductRows = rules.some((r) =>
    ["tag", "cashback", "viewers"].includes(r.match_type) ||
    ["cashback", "viewers"].includes(r.badge_type || "static")
  );
  let productCache: ShelfProductRow[] = [];
  if (needProductRows) {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: page } = await admin
        .from("shelf_products")
        .select("product_id, sku, tags, category, name, price, sale_price")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .eq("in_stock", true)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      productCache.push(...(page as ShelfProductRow[]));
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }

  const productById = new Map<string, ShelfProductRow>();
  for (const p of productCache) productById.set(p.product_id, p);

  const matches: Record<string, PromoTagRule[]> = {};
  const hourMult = hourMultiplier(currentHourBRT());
  // Fetch GA4-derived popularity once per request (cached 1h in-memory)
  const popularity = await getPopularityScores(workspaceId);
  const salesSignals = needProductRows
    ? await getRecentSalesSignals(workspaceId, productCache)
    : new Map<string, SalesSignal>();

  for (const rule of rules) {
    let productIds: string[] = [];
    const badgeType: BadgeType = (rule.badge_type as BadgeType) || "static";
    const placement: BadgePlacement = (rule.badge_placement as BadgePlacement) || "auto";
    const viewersMin = Number(rule.viewers_min) || 6;
    const viewersMax = Number(rule.viewers_max) || 42;
    const pageTargets = normalizePromoTagPages(rule.show_on_pages);
    const modal = extractPromoTagModalMetadata(rule);
    const comboTiers = extractPromoTagComboTiers(rule);

    switch (rule.match_type) {
      case "tag": {
        productIds = productCache
          .filter((p) => productMatchesTag(p, rule.match_value))
          .map((p) => p.product_id);
        break;
      }
      case "category": {
        const { data: products } = await admin
          .from("shelf_products")
          .select("product_id")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .ilike("category", rule.match_value);
        productIds = (products || []).map((p) => p.product_id);
        break;
      }
      case "name_pattern": {
        const pattern = rule.match_value
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_")
          .replace(/\*/g, "%");
        const { data: products } = await admin
          .from("shelf_products")
          .select("product_id")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .ilike("name", pattern);
        productIds = (products || []).map((p) => p.product_id);
        break;
      }
      case "product_ids": {
        productIds = rule.match_value
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
        break;
      }
    }

    for (const pid of productIds) {
      const baseRule: PromoTagRule = {
        badge_text: rule.badge_text,
        badge_bg_color: rule.badge_bg_color,
        badge_text_color: rule.badge_text_color,
        badge_font_size: rule.badge_font_size,
        badge_border_radius: rule.badge_border_radius,
        badge_position: rule.badge_position,
        badge_padding: rule.badge_padding,
        badge_type: badgeType,
        badge_placement: placement,
        priority: rule.priority,
        show_on_pages: pageTargets,
        modal_title: modal.modal_title,
        modal_body: modal.modal_body,
        combo_tiers: comboTiers,
      };

      // Per-product enrichment
      if (badgeType === "cashback" && cashbackPercent > 0) {
        const p = productById.get(pid);
        const effectivePrice = p ? Number(p.sale_price ?? p.price ?? 0) : 0;
        if (effectivePrice > 0) {
          baseRule.cashback_value = (effectivePrice * cashbackPercent) / 100;
        }
      } else if (badgeType === "viewers") {
        const p = productById.get(pid);
        if (p) {
          const score = lookupPopularity(p, popularity);
          baseRule.viewers_baseline = computeViewersBaseline(
            p,
            viewersMin,
            viewersMax,
            hourMult,
            score,
            salesSignals.get(pid)
          );
          baseRule.viewers_min = viewersMin;
          baseRule.viewers_max = viewersMax;
        }
      }

      if (!matches[pid]) matches[pid] = [];
      matches[pid].push(baseRule);
    }
  }

  // --- Inject countdown coupon badges from active rotation coupons ---
  // Each active coupon (status='active', not expired) becomes a synthetic
  // badge attached to its product. The plan_id link gives us the badge styling.
  const nowIso = new Date().toISOString();
  const { data: activeCoupons } = await admin
    .from("promo_active_coupons")
    .select("product_id, vnda_coupon_code, discount_pct, expires_at, plan_id, promo_coupon_plans(badge_template, badge_bg_color, badge_text_color)")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .gt("expires_at", nowIso);

  for (const c of (activeCoupons || []) as unknown as Array<{
    product_id: string;
    vnda_coupon_code: string;
    discount_pct: number;
    expires_at: string;
    promo_coupon_plans?: { badge_template?: string; badge_bg_color?: string; badge_text_color?: string }
      | Array<{ badge_template?: string; badge_bg_color?: string; badge_text_color?: string }>;
  }>) {
    const plan = Array.isArray(c.promo_coupon_plans) ? c.promo_coupon_plans[0] : c.promo_coupon_plans;
    const badgeRule: PromoTagRule = {
      badge_text: plan?.badge_template || "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}",
      badge_bg_color: plan?.badge_bg_color || "#dc2626",
      badge_text_color: plan?.badge_text_color || "#ffffff",
      badge_font_size: "12px",
      badge_border_radius: "6px",
      badge_position: "top-left",
      badge_padding: "5px 12px",
      badge_type: "coupon_countdown",
      badge_placement: "pdp_price",
      priority: 100, // coupons take precedence in the row
      coupon_code: c.vnda_coupon_code,
      coupon_discount_pct: Number(c.discount_pct),
      coupon_expires_at: c.expires_at,
    };
    if (!matches[c.product_id]) matches[c.product_id] = [];
    matches[c.product_id].push(badgeRule);
  }

  return { matches, cashback_percent: cashbackPercent };
}
