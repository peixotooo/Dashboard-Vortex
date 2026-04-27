// Picks low-rotation products + assigns discount percentages within the
// plan's [min, max] band. Pure function — does NOT call VNDA or write to DB.

import type { ProductPerformance } from "./performance";

// Hard ceiling enforced regardless of plan config (margin protection)
export const HARD_DISCOUNT_CAP_PCT = 25;
// Hard ceiling on simultaneous active coupons per plan
export const HARD_MAX_ACTIVE = 20;

export interface CouponPick {
  product_id: string;
  name: string;
  effective_price: number;
  views: number;
  units_sold: number;
  revenue: number;
  cvr: number;
  abc_tier: "A" | "B" | "C";
  low_rotation_score: number;
  discount_pct: number;
  reason: string;
}

export interface PickerInput {
  performance: ProductPerformance[];
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  manualProductIds?: string[];
  discountMinPct: number;
  discountMaxPct: number;
  maxActiveProducts: number;
  excludeProductIds?: Set<string>; // products that already have a live coupon
}

function clampDiscount(pct: number): number {
  if (pct > HARD_DISCOUNT_CAP_PCT) return HARD_DISCOUNT_CAP_PCT;
  if (pct < 1) return 1;
  return Math.round(pct);
}

function roundToStep(pct: number, step = 5): number {
  return Math.round(pct / step) * step;
}

export function pickCouponCandidates(input: PickerInput): CouponPick[] {
  const minPct = clampDiscount(Math.max(1, input.discountMinPct));
  const maxPct = clampDiscount(Math.max(minPct, input.discountMaxPct));
  const limit = Math.min(HARD_MAX_ACTIVE, Math.max(1, input.maxActiveProducts));
  const excluded = input.excludeProductIds || new Set<string>();

  let candidates: ProductPerformance[];
  switch (input.target) {
    case "manual": {
      const ids = new Set(input.manualProductIds || []);
      candidates = input.performance.filter((p) => ids.has(p.product_id));
      break;
    }
    case "tier_b":
      candidates = input.performance.filter((p) => p.abc_tier === "B");
      break;
    case "tier_c":
      candidates = input.performance.filter((p) => p.abc_tier === "C");
      break;
    case "low_cvr_high_views":
    default:
      // All non-A products with at least some views — prevents picking obscure SKUs
      candidates = input.performance.filter((p) => p.abc_tier !== "A" && p.views >= 50);
      break;
  }

  // Exclude products already on a live coupon
  candidates = candidates.filter((p) => !excluded.has(p.product_id));

  // Rank by score DESC and take top N
  candidates.sort((a, b) => b.low_rotation_score - a.low_rotation_score);
  candidates = candidates.slice(0, limit);

  // Discount picker: higher score → higher discount, rounded to 5%
  const range = maxPct - minPct;
  return candidates.map((p) => {
    const raw = minPct + p.low_rotation_score * range;
    const discount = clampDiscount(roundToStep(raw, 5));
    let reason = "";
    if (input.target === "manual") {
      reason = "Selecionado manualmente";
    } else if (input.target === "tier_b") {
      reason = `Tier B (B-vendido) — score ${p.low_rotation_score.toFixed(2)}`;
    } else if (input.target === "tier_c") {
      reason = `Tier C (cauda longa) — score ${p.low_rotation_score.toFixed(2)}`;
    } else {
      reason = `Muito visto + pouca conversão — ${p.views} views, CVR ${(p.cvr * 100).toFixed(2)}%`;
    }
    return {
      product_id: p.product_id,
      name: p.name,
      effective_price: p.effective_price,
      views: p.views,
      units_sold: p.units_sold,
      revenue: p.revenue,
      cvr: p.cvr,
      abc_tier: p.abc_tier,
      low_rotation_score: p.low_rotation_score,
      discount_pct: discount,
      reason,
    };
  });
}

export function generateCouponCode(productId: string, discountPct: number): string {
  // 4-char random suffix so the code is unique even within the same product/discount
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  // Truncate product id so the code stays under 16 chars
  const pid = productId.replace(/\W/g, "").slice(-4);
  return `FLASH${pid}${discountPct}${rand}`;
}
