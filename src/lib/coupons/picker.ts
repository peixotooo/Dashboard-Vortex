// Picks low-rotation products + assigns discount percentages within the
// plan's [min, max] band. Pure function — does NOT call VNDA or write to DB.
//
// Safety: callers must pass workspace settings so we can enforce the
// configurable global ceilings (global_max_discount_pct / global_max_active_coupons).
// There are NO hard-coded caps here anymore — caps live in the workspace settings
// row (defaults: 25% discount, 30 active coupons), editable from the dashboard.

import type { ProductPerformance } from "./performance";
import type { CouponWorkspaceSettings } from "./settings";

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
  /** True when the configured plan max was clamped down by workspace settings */
  clamped_by_workspace_cap: boolean;
}

export interface PickerInput {
  performance: ProductPerformance[];
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  manualProductIds?: string[];
  discountMinPct: number;
  discountMaxPct: number;
  maxActiveProducts: number;
  excludeProductIds?: Set<string>; // products that already have a live coupon
  settings: CouponWorkspaceSettings;
  /** How many active coupons the workspace already has across all plans */
  workspaceActiveCount: number;
}

function roundToStep(pct: number, step = 5): number {
  return Math.round(pct / step) * step;
}

export function pickCouponCandidates(input: PickerInput): CouponPick[] {
  const { settings } = input;
  const cap = settings.global_max_discount_pct;

  // Effective bounds: plan can never exceed the workspace cap
  const effectiveMin = Math.max(1, Math.min(input.discountMinPct, cap));
  const effectiveMax = Math.max(effectiveMin, Math.min(input.discountMaxPct, cap));
  const wasClamped = input.discountMaxPct > cap;

  // Slot budget: how many MORE coupons this workspace can spawn right now
  const remainingBudget = Math.max(0, settings.global_max_active_coupons - input.workspaceActiveCount);
  const planSlots = Math.max(0, Math.min(input.maxActiveProducts, remainingBudget));
  if (planSlots === 0) return [];

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
      // Non-A products with at least some views (avoids picking obscure SKUs)
      candidates = input.performance.filter((p) => p.abc_tier !== "A" && p.views >= 50);
      break;
  }

  // Drop products that already have a live coupon
  candidates = candidates.filter((p) => !excluded.has(p.product_id));

  // Highest score wins; respect plan + workspace slot budget
  candidates.sort((a, b) => b.low_rotation_score - a.low_rotation_score);
  candidates = candidates.slice(0, planSlots);

  const range = effectiveMax - effectiveMin;
  return candidates.map((p) => {
    const raw = effectiveMin + p.low_rotation_score * range;
    let discount = roundToStep(raw, 5);
    // Clamp inside [effectiveMin, effectiveMax] (rounding could push out)
    if (discount < effectiveMin) discount = Math.ceil(effectiveMin);
    if (discount > effectiveMax) discount = Math.floor(effectiveMax);
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
      clamped_by_workspace_cap: wasClamped,
    };
  });
}

/**
 * Coupon code generator. Format: FLASH<pid4><pct><rand4>
 * UNIQUE constraint on vnda_coupon_code in DB will catch the rare collision —
 * caller should retry on conflict.
 */
export function generateCouponCode(productId: string, discountPct: number): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const pid = productId.replace(/\W/g, "").slice(-4);
  return `FLASH${pid}${discountPct}${rand}`;
}
