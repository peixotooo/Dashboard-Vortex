import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";

// --- Popularity cache: GA4 itemsViewed last 30d, normalized 0-1 (per workspace) ---

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
  // Pre-computed per-product values (only present for dynamic badge types)
  cashback_value?: number;     // R$ this product earns in cashback
  viewers_baseline?: number;   // server-suggested live viewer count
  viewers_min?: number;
  viewers_max?: number;
  // Countdown coupon — emitted when an active coupon exists for this product
  coupon_code?: string;
  coupon_discount_pct?: number;
  coupon_expires_at?: string;  // ISO timestamp
}

interface ShelfProductRow {
  product_id: string;
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
    0.30, 0.20, 0.18, 0.15, 0.15, 0.20,  // 0-5
    0.30, 0.45, 0.60, 0.75, 0.85, 0.85,  // 6-11
    0.90, 0.85, 0.80, 0.85, 0.90, 0.95,  // 12-17
    1.00, 1.00, 1.00, 0.95, 0.80, 0.55,  // 18-23
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
  let h = 5381;
  for (let i = 0; i < productId.length; i++) {
    h = ((h << 5) + h + productId.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000; // 0..1
}

/**
 * Two-arg seed (product + extra) for a second deterministic dim — used to
 * shift each product slightly per day so the same SKU doesn't show the
 * same baseline today vs tomorrow.
 */
function combinedSeed(productId: string, salt: string): number {
  let h = 5381;
  const s = productId + "|" + salt;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000;
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

function computeViewersBaseline(
  product: ShelfProductRow,
  min: number,
  max: number,
  hourMult: number,
  popularityScore: number // -1 if unknown, else 0..1 percentile rank from GA4
): number {
  let rankWeight: number;
  if (popularityScore >= 0) {
    rankWeight = popularityScore;
  } else {
    const tagsArr =
      (product.tags as { vnda_tags?: Array<{ name?: string } | string> })?.vnda_tags ||
      (Array.isArray(product.tags) ? product.tags : []);
    rankWeight = 0.30;
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

  const seed = productSeed(product.product_id);
  // Per-day per-product seed — different number every day for the same SKU
  const todaySeed = combinedSeed(product.product_id, new Date().toISOString().slice(0, 10));
  // Global day shift — moves the whole store up/down on a given day
  const dayJitter = dayShift();

  // Mix the four signals:
  //   30% popularity rank (real GA4 percentile)
  //   25% hour-of-day curve (Brasília)
  //   25% per-product stable seed
  //   12% per-day per-product variation
  //    8% global daily shift
  const factor =
    rankWeight * 0.30 +
    hourMult * 0.25 +
    (seed - 0.5) * 0.50 +              // ±25%
    (todaySeed - 0.5) * 0.24 +          // ±12%
    dayJitter * 0.16;                    // ±8%

  // Wider output range — top products near max, bottom near min, but never exact
  const compressed = Math.max(0, Math.min(1, factor + 0.5));
  const ratio = 0.05 + compressed * 0.90;
  const range = Math.max(0, max - min);
  return Math.max(min, Math.min(max, Math.round(min + range * ratio)));
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
        .select("product_id, tags, category, name, price, sale_price")
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

  for (const rule of rules) {
    let productIds: string[] = [];
    const badgeType: BadgeType = (rule.badge_type as BadgeType) || "static";
    const placement: BadgePlacement = (rule.badge_placement as BadgePlacement) || "auto";
    const viewersMin = Number(rule.viewers_min) || 6;
    const viewersMax = Number(rule.viewers_max) || 42;

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
          baseRule.viewers_baseline = computeViewersBaseline(p, viewersMin, viewersMax, hourMult, score);
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
