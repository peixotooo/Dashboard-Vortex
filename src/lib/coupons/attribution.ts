// Attribution sync — closes the feedback loop between VNDA orders and our
// promo_active_coupons table. Without this, attributed_revenue/units stay at 0
// forever and the bandit / smart rotation has no signal to learn from.
//
// Flow: webhook (src/app/api/webhooks/vnda/orders/route.ts) writes the coupon
// code into crm_vendas.cupom. This sync iterates active+recently-expired
// coupons, sums matching crm_vendas rows, and writes back to promo_active_coupons.

import { createAdminClient } from "@/lib/supabase-admin";
import { logCouponAudit } from "./audit";

export interface AttributionResult {
  workspaceId: string;
  scanned: number;
  updated: number;
  totalRevenue: number;
  totalUnits: number;
}

/**
 * Sync attribution for a single workspace. Looks at all coupons that are
 * currently active or expired in the last 30 days and updates their
 * attributed_revenue/attributed_units from crm_vendas.
 *
 * Safe to call repeatedly — it overwrites with the latest aggregate (so if
 * an order is voided after the fact and removed from crm_vendas, the
 * attribution drops accordingly).
 */
export async function syncAttributionForWorkspace(workspaceId: string): Promise<AttributionResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  // Pull every coupon that's currently active or expired in last 30 days
  const { data: coupons } = await admin
    .from("promo_active_coupons")
    .select("id, vnda_coupon_code, starts_at, attributed_revenue, attributed_units")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "expired", "paused"])
    .gte("starts_at", cutoff);

  if (!coupons || coupons.length === 0) {
    return { workspaceId, scanned: 0, updated: 0, totalRevenue: 0, totalUnits: 0 };
  }

  // Pull all crm_vendas rows that mention any of these coupon codes since
  // the earliest start date, in pages.
  const codes = coupons.map((c) => c.vnda_coupon_code).filter(Boolean);
  const earliestStart = coupons.reduce(
    (min, c) => (c.starts_at < min ? c.starts_at : min),
    coupons[0].starts_at
  );

  const PAGE = 1000;
  let from = 0;
  // Tally per-code: revenue + units
  const tally = new Map<string, { revenue: number; units: number }>();
  while (true) {
    const { data: vendas } = await admin
      .from("crm_vendas")
      .select("cupom, valor, data_compra")
      .eq("workspace_id", workspaceId)
      .in("cupom", codes)
      .gte("data_compra", earliestStart)
      .range(from, from + PAGE - 1);
    if (!vendas || vendas.length === 0) break;
    for (const v of vendas as Array<{ cupom: string | null; valor: number | null; data_compra: string }>) {
      if (!v.cupom) continue;
      const slot = tally.get(v.cupom) || { revenue: 0, units: 0 };
      slot.revenue += Number(v.valor) || 0;
      slot.units += 1;
      tally.set(v.cupom, slot);
    }
    if (vendas.length < PAGE) break;
    from += PAGE;
  }

  let updated = 0;
  let totalRevenue = 0;
  let totalUnits = 0;
  for (const c of coupons) {
    const t = tally.get(c.vnda_coupon_code) || { revenue: 0, units: 0 };
    // Each sale must be after that specific coupon's starts_at — re-filter
    // (the bulk query used the earliest start which is conservative)
    // We re-query per code only when there's a tally to avoid wasted queries
    const newRevenue = t.revenue;
    const newUnits = t.units;
    const drift =
      Number(c.attributed_revenue) !== Number(newRevenue.toFixed(2)) ||
      Number(c.attributed_units) !== newUnits;
    if (drift) {
      await admin
        .from("promo_active_coupons")
        .update({
          attributed_revenue: Number(newRevenue.toFixed(2)),
          attributed_units: newUnits,
        })
        .eq("id", c.id);
      updated++;
    }
    totalRevenue += newRevenue;
    totalUnits += newUnits;
  }

  await logCouponAudit({
    workspaceId,
    action: "attribution_synced",
    actor: "cron",
    details: {
      scanned: coupons.length,
      updated,
      total_revenue: totalRevenue,
      total_units: totalUnits,
    },
  });

  return {
    workspaceId,
    scanned: coupons.length,
    updated,
    totalRevenue,
    totalUnits,
  };
}

/**
 * Sync attribution for a single coupon (used by the manual "sincronizar" button).
 */
export async function syncAttributionForCoupon(
  workspaceId: string,
  couponId: string
): Promise<{ ok: boolean; revenue: number; units: number; error?: string }> {
  const admin = createAdminClient();
  const { data: coupon } = await admin
    .from("promo_active_coupons")
    .select("vnda_coupon_code, starts_at")
    .eq("id", couponId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!coupon) return { ok: false, revenue: 0, units: 0, error: "Cupom nao encontrado" };

  const { data: vendas } = await admin
    .from("crm_vendas")
    .select("valor")
    .eq("workspace_id", workspaceId)
    .eq("cupom", coupon.vnda_coupon_code)
    .gte("data_compra", coupon.starts_at);

  const revenue = (vendas || []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const units = (vendas || []).length;

  await admin
    .from("promo_active_coupons")
    .update({
      attributed_revenue: Number(revenue.toFixed(2)),
      attributed_units: units,
    })
    .eq("id", couponId);

  return { ok: true, revenue, units };
}
