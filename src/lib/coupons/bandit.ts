// Multi-armed bandit for the % vs R$ discount unit decision.
//
// Strategy: epsilon-greedy with cold-start.
//   - Cold-start (< 10 attempts in either arm): force 50/50 random
//   - Warm: 80% greedy (pick the arm with higher revenue per attempt)
//          20% explore (50/50 random)
//
// Stats live in coupon_bandit_stats and are recomputed by the attribution
// cron after it syncs revenue. The picker calls chooseUnitFromBandit() when
// a smart plan has discount_unit='auto'.

import { createAdminClient } from "@/lib/supabase-admin";
import { logCouponAudit } from "./audit";

export interface BanditStats {
  pct_attempts: number;
  pct_revenue: number;
  pct_units: number;
  brl_attempts: number;
  brl_revenue: number;
  brl_units: number;
  last_recomputed_at: string | null;
}

const ZERO_STATS: BanditStats = {
  pct_attempts: 0,
  pct_revenue: 0,
  pct_units: 0,
  brl_attempts: 0,
  brl_revenue: 0,
  brl_units: 0,
  last_recomputed_at: null,
};

const COLD_START_THRESHOLD = 10;
const EPSILON = 0.2; // 20% explore

export async function getBanditStats(workspaceId: string): Promise<BanditStats> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("coupon_bandit_stats")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return { ...ZERO_STATS };
  return {
    pct_attempts: Number(data.pct_attempts) || 0,
    pct_revenue: Number(data.pct_revenue) || 0,
    pct_units: Number(data.pct_units) || 0,
    brl_attempts: Number(data.brl_attempts) || 0,
    brl_revenue: Number(data.brl_revenue) || 0,
    brl_units: Number(data.brl_units) || 0,
    last_recomputed_at: data.last_recomputed_at || null,
  };
}

/**
 * Recomputes bandit stats from scratch by aggregating every coupon ever
 * created in this workspace by discount_unit. Idempotent.
 */
export async function recomputeBanditStats(workspaceId: string): Promise<BanditStats> {
  const admin = createAdminClient();

  // Pull all coupons that ever ran (active/expired/paused — drops never-pushed
  // pending/failed/cancelled rows since they don't count as attempts).
  const PAGE = 1000;
  let from = 0;
  const stats = { ...ZERO_STATS };
  while (true) {
    const { data: page } = await admin
      .from("promo_active_coupons")
      .select("discount_unit, attributed_revenue, attributed_units")
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "expired", "paused"])
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    for (const c of page as Array<{ discount_unit: string | null; attributed_revenue: number | null; attributed_units: number | null }>) {
      const unit = c.discount_unit === "brl" ? "brl" : "pct";
      const rev = Number(c.attributed_revenue) || 0;
      const units = Number(c.attributed_units) || 0;
      if (unit === "pct") {
        stats.pct_attempts += 1;
        stats.pct_revenue += rev;
        stats.pct_units += units;
      } else {
        stats.brl_attempts += 1;
        stats.brl_revenue += rev;
        stats.brl_units += units;
      }
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }

  await admin
    .from("coupon_bandit_stats")
    .upsert({
      workspace_id: workspaceId,
      pct_attempts: stats.pct_attempts,
      pct_revenue: stats.pct_revenue,
      pct_units: stats.pct_units,
      brl_attempts: stats.brl_attempts,
      brl_revenue: stats.brl_revenue,
      brl_units: stats.brl_units,
      last_recomputed_at: new Date().toISOString(),
    });

  await logCouponAudit({
    workspaceId,
    action: "bandit_recomputed",
    actor: "cron",
    details: stats as unknown as Record<string, unknown>,
  });

  return { ...stats, last_recomputed_at: new Date().toISOString() };
}

/**
 * Epsilon-greedy choice between 'pct' and 'brl'.
 * Cold-start: if either arm has fewer than COLD_START_THRESHOLD attempts,
 * always go 50/50. After warm-up, 80% pick the higher revenue/attempt arm,
 * 20% explore the other one (or random if tied).
 *
 * Returns the chosen unit + reason for audit logging.
 */
export interface BanditChoice {
  unit: "pct" | "brl";
  reason: "cold_start" | "explore" | "exploit_pct" | "exploit_brl" | "tied";
  pct_rpa: number; // revenue per attempt
  brl_rpa: number;
}

export async function chooseUnitFromBandit(workspaceId: string): Promise<BanditChoice> {
  const stats = await getBanditStats(workspaceId);
  const pctRpa = stats.pct_attempts > 0 ? stats.pct_revenue / stats.pct_attempts : 0;
  const brlRpa = stats.brl_attempts > 0 ? stats.brl_revenue / stats.brl_attempts : 0;

  // Cold-start
  if (stats.pct_attempts < COLD_START_THRESHOLD || stats.brl_attempts < COLD_START_THRESHOLD) {
    return {
      unit: Math.random() < 0.5 ? "pct" : "brl",
      reason: "cold_start",
      pct_rpa: pctRpa,
      brl_rpa: brlRpa,
    };
  }

  // 20% explore — flip random
  if (Math.random() < EPSILON) {
    return {
      unit: Math.random() < 0.5 ? "pct" : "brl",
      reason: "explore",
      pct_rpa: pctRpa,
      brl_rpa: brlRpa,
    };
  }

  // 80% greedy — exploit higher RPA
  if (Math.abs(pctRpa - brlRpa) < 0.01) {
    return {
      unit: Math.random() < 0.5 ? "pct" : "brl",
      reason: "tied",
      pct_rpa: pctRpa,
      brl_rpa: brlRpa,
    };
  }
  if (pctRpa > brlRpa) {
    return { unit: "pct", reason: "exploit_pct", pct_rpa: pctRpa, brl_rpa: brlRpa };
  }
  return { unit: "brl", reason: "exploit_brl", pct_rpa: pctRpa, brl_rpa: brlRpa };
}
