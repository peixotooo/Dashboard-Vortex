// Orchestrates the coupon lifecycle:
//   1. expireOldCoupons    — flips active → expired and pauses VNDA promotion
//   2. autoCancelStalePending — expires pending rows older than TTL
//   3. proposeNewCoupons   — runs picker per enabled plan and inserts pending rows
//   4. approveCoupon       — hits VNDA, flips pending → active (or failed)
//   5. rejectCoupon        — flips pending → cancelled (no VNDA call)
//
// All VNDA calls go through coupons/vnda-coupons.ts which handles auth + rollback.
// All state transitions are written to coupon_audit_log.

import { createAdminClient } from "@/lib/supabase-admin";
import { logCouponAudit } from "./audit";
import { computeProductPerformance } from "./performance";
import { pickCouponCandidates, generateCouponCode } from "./picker";
import { getCouponSettings } from "./settings";
import {
  getVndaConfigForWorkspace,
  createFullCoupon,
  pauseVndaPromotion,
  VndaError,
} from "./vnda-coupons";

// --- Types from DB rows we touch ---

interface PlanRow {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  mode: "one_shot" | "recurring";
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  manual_product_ids: string[] | null;
  discount_min_pct: number;
  discount_max_pct: number;
  duration_hours: number;
  max_active_products: number;
  recurring_cron: string | null;
  recurring_last_run_at: string | null;
  require_manual_approval: boolean;
}

interface ActiveCouponRow {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  product_id: string;
  vnda_discount_id: number | null;
  vnda_coupon_code: string;
  discount_pct: number;
  starts_at: string;
  expires_at: string;
  status: string;
  created_at: string;
}

// --- 1. Expire ---

export async function expireOldCoupons(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: due } = await admin
    .from("promo_active_coupons")
    .select("id, plan_id, product_id, vnda_discount_id, vnda_coupon_code")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .lt("expires_at", now);
  if (!due || due.length === 0) return 0;

  const config = await getVndaConfigForWorkspace(workspaceId);

  for (const row of due) {
    // Pause on VNDA first; if it fails, keep DB as active so we retry next cycle
    if (config && row.vnda_discount_id) {
      await logCouponAudit({
        workspaceId,
        action: "vnda_pause_attempt",
        actor: "cron",
        planId: row.plan_id || undefined,
        activeCouponId: row.id,
        productId: row.product_id,
        details: { promotion_id: row.vnda_discount_id, reason: "expired" },
      });
      try {
        await pauseVndaPromotion(config, row.vnda_discount_id);
        await logCouponAudit({
          workspaceId,
          action: "vnda_pause_ok",
          actor: "cron",
          activeCouponId: row.id,
          productId: row.product_id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logCouponAudit({
          workspaceId,
          action: "vnda_pause_fail",
          actor: "cron",
          activeCouponId: row.id,
          productId: row.product_id,
          errorMessage: msg,
        });
        // Skip status flip — try again next cycle
        continue;
      }
    }
    await admin
      .from("promo_active_coupons")
      .update({ status: "expired" })
      .eq("id", row.id);
    await logCouponAudit({
      workspaceId,
      action: "auto_expired",
      actor: "cron",
      activeCouponId: row.id,
      productId: row.product_id,
    });
  }
  return due.length;
}

// --- 2. Cancel stale pending (older than settings.pending_approval_ttl_hours) ---

export async function cancelStalePending(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const settings = await getCouponSettings(workspaceId);
  const cutoff = new Date(Date.now() - settings.pending_approval_ttl_hours * 3600_000).toISOString();
  const { data } = await admin
    .from("promo_active_coupons")
    .select("id, plan_id, product_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .lt("created_at", cutoff);
  if (!data || data.length === 0) return 0;
  await admin
    .from("promo_active_coupons")
    .update({ status: "cancelled", status_reason: "approval_ttl_expired" })
    .in("id", data.map((d) => d.id));
  for (const row of data) {
    await logCouponAudit({
      workspaceId,
      action: "auto_expired",
      actor: "cron",
      planId: row.plan_id || undefined,
      activeCouponId: row.id,
      productId: row.product_id,
      details: { reason: "pending_ttl_expired", ttl_hours: settings.pending_approval_ttl_hours },
    });
  }
  return data.length;
}

// --- 3. Propose new (per plan) ---

export interface ProposeResult {
  planId: string;
  inserted: number;
  skipped: number;
}

export async function proposeNewCoupons(
  workspaceId: string,
  options: { onlyPlanIds?: string[] } = {}
): Promise<ProposeResult[]> {
  const admin = createAdminClient();
  const settings = await getCouponSettings(workspaceId);

  // Plans we should consider this run
  let q = admin
    .from("promo_coupon_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);
  if (options.onlyPlanIds && options.onlyPlanIds.length > 0) {
    q = q.in("id", options.onlyPlanIds);
  }
  const { data: plans } = await q;
  if (!plans || plans.length === 0) return [];

  // Performance computed once, reused across plans
  const perf = await computeProductPerformance(workspaceId);

  // Already-live coupons (used by picker excludes + global budget counter)
  const { data: live } = await admin
    .from("promo_active_coupons")
    .select("product_id, status")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "pending"]);
  const excludeProductIds = new Set((live || []).map((l) => l.product_id));
  const workspaceActiveCount = (live || []).length;

  const results: ProposeResult[] = [];

  for (const plan of plans as PlanRow[]) {
    const picks = pickCouponCandidates({
      performance: perf,
      target: plan.target,
      manualProductIds: plan.manual_product_ids || undefined,
      discountMinPct: Number(plan.discount_min_pct),
      discountMaxPct: Number(plan.discount_max_pct),
      maxActiveProducts: plan.max_active_products,
      excludeProductIds,
      settings,
      workspaceActiveCount,
    });

    if (picks.length === 0) {
      await logCouponAudit({
        workspaceId,
        action: "cron_skipped",
        actor: "cron",
        planId: plan.id,
        details: { reason: "no_candidates", plan_name: plan.name },
      });
      results.push({ planId: plan.id, inserted: 0, skipped: 0 });
      continue;
    }

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + plan.duration_hours * 3600_000);

    let inserted = 0;
    for (const pick of picks) {
      // Try a few times in case of UNIQUE collision on coupon code
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateCouponCode(pick.product_id, pick.discount_pct);
        const { error } = await admin.from("promo_active_coupons").insert({
          workspace_id: workspaceId,
          plan_id: plan.id,
          product_id: pick.product_id,
          vnda_coupon_code: code,
          discount_pct: pick.discount_pct,
          starts_at: startsAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          status: "pending",
        });
        if (!error) {
          inserted++;
          break;
        }
        if (!error.message.toLowerCase().includes("unique")) {
          // Some other DB error — log and stop trying this product
          await logCouponAudit({
            workspaceId,
            action: "cron_skipped",
            actor: "cron",
            planId: plan.id,
            productId: pick.product_id,
            errorMessage: error.message,
          });
          break;
        }
      }
      // Track pick (success or not) so audit shows what cron evaluated
      await logCouponAudit({
        workspaceId,
        action: "cron_picked",
        actor: "cron",
        planId: plan.id,
        productId: pick.product_id,
        details: {
          discount_pct: pick.discount_pct,
          score: pick.low_rotation_score,
          tier: pick.abc_tier,
          views: pick.views,
          cvr: pick.cvr,
          coupon_code: code,
          require_manual_approval: plan.require_manual_approval,
        },
      });
    }

    // Update last_run_at for recurring plans so the cron can space them
    await admin
      .from("promo_coupon_plans")
      .update({ recurring_last_run_at: new Date().toISOString() })
      .eq("id", plan.id);

    results.push({ planId: plan.id, inserted, skipped: picks.length - inserted });
  }
  return results;
}

// --- 4. Approve a single pending coupon: hit VNDA + flip to active ---

export async function approveCoupon(
  workspaceId: string,
  couponId: string,
  actor: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("promo_active_coupons")
    .select("*")
    .eq("id", couponId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!row) return { ok: false, error: "Cupom nao encontrado" };
  if (row.status !== "pending") return { ok: false, error: `Status atual: ${row.status}` };

  // Re-check stock before pushing to VNDA
  const { data: prod } = await admin
    .from("shelf_products")
    .select("active, in_stock, name")
    .eq("workspace_id", workspaceId)
    .eq("product_id", row.product_id)
    .maybeSingle();
  if (!prod) {
    await admin
      .from("promo_active_coupons")
      .update({ status: "cancelled", status_reason: "product_not_found" })
      .eq("id", row.id);
    await logCouponAudit({ workspaceId, action: "product_inactive", actor, activeCouponId: row.id, productId: row.product_id });
    return { ok: false, error: "Produto nao encontrado em shelf_products" };
  }
  if (!prod.active || !prod.in_stock) {
    await admin
      .from("promo_active_coupons")
      .update({ status: "cancelled", status_reason: prod.in_stock ? "product_inactive" : "out_of_stock" })
      .eq("id", row.id);
    await logCouponAudit({
      workspaceId,
      action: prod.in_stock ? "product_inactive" : "product_out_of_stock",
      actor,
      activeCouponId: row.id,
      productId: row.product_id,
    });
    return { ok: false, error: prod.in_stock ? "Produto inativo" : "Produto sem estoque" };
  }

  const config = await getVndaConfigForWorkspace(workspaceId);
  if (!config) return { ok: false, error: "VNDA nao configurada" };

  const settings = await getCouponSettings(workspaceId);

  await logCouponAudit({
    workspaceId,
    action: "vnda_create_attempt",
    actor,
    activeCouponId: row.id,
    productId: row.product_id,
    details: { coupon_code: row.vnda_coupon_code, discount_pct: row.discount_pct },
  });

  try {
    const result = await createFullCoupon(config, {
      name: `Vortex ${row.vnda_coupon_code} (${prod.name?.slice(0, 40) || row.product_id})`,
      code: row.vnda_coupon_code,
      product_id: row.product_id,
      discount_pct: Number(row.discount_pct),
      starts_at: new Date(row.starts_at),
      expires_at: new Date(row.expires_at),
      cumulative: settings.cumulative_with_other_promos,
      uses_per_code: settings.default_uses_per_code,
      uses_per_user: settings.default_uses_per_user,
    });

    await admin
      .from("promo_active_coupons")
      .update({
        status: "active",
        vnda_discount_id: result.promotion_id,
        vnda_rule_id: result.rule_id,
        approved_at: new Date().toISOString(),
        pushed_to_vnda_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    await logCouponAudit({
      workspaceId,
      action: "vnda_create_ok",
      actor,
      activeCouponId: row.id,
      productId: row.product_id,
      details: result as unknown as Record<string, unknown>,
    });
    await logCouponAudit({
      workspaceId,
      action: "approved",
      actor,
      activeCouponId: row.id,
      productId: row.product_id,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof VndaError ? err.message : err instanceof Error ? err.message : String(err);
    await admin
      .from("promo_active_coupons")
      .update({ status: "failed", status_reason: msg.slice(0, 250) })
      .eq("id", row.id);
    await logCouponAudit({
      workspaceId,
      action: "vnda_create_fail",
      actor,
      activeCouponId: row.id,
      productId: row.product_id,
      errorMessage: msg,
    });
    return { ok: false, error: msg };
  }
}

// --- 5. Reject a pending coupon (no VNDA call) ---

export async function rejectCoupon(
  workspaceId: string,
  couponId: string,
  actor: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("promo_active_coupons")
    .select("id, status, plan_id, product_id")
    .eq("id", couponId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!row) return { ok: false, error: "Cupom nao encontrado" };
  if (row.status !== "pending") return { ok: false, error: `Status atual: ${row.status}` };

  await admin
    .from("promo_active_coupons")
    .update({ status: "cancelled", status_reason: reason || "rejected_by_user" })
    .eq("id", row.id);
  await logCouponAudit({
    workspaceId,
    action: "rejected",
    actor,
    planId: row.plan_id || undefined,
    activeCouponId: row.id,
    productId: row.product_id,
    details: { reason: reason || null },
  });
  return { ok: true };
}

// --- 6. Manual pause of an active coupon ---

export async function pauseActiveCoupon(
  workspaceId: string,
  couponId: string,
  actor: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("promo_active_coupons")
    .select("*")
    .eq("id", couponId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!row) return { ok: false, error: "Cupom nao encontrado" };
  if (row.status !== "active") return { ok: false, error: `Status atual: ${row.status}` };

  const config = await getVndaConfigForWorkspace(workspaceId);
  if (config && row.vnda_discount_id) {
    try {
      await pauseVndaPromotion(config, row.vnda_discount_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logCouponAudit({
        workspaceId,
        action: "vnda_pause_fail",
        actor,
        activeCouponId: row.id,
        productId: row.product_id,
        errorMessage: msg,
      });
      return { ok: false, error: msg };
    }
  }
  await admin
    .from("promo_active_coupons")
    .update({ status: "paused" })
    .eq("id", row.id);
  await logCouponAudit({
    workspaceId,
    action: "manual_pause",
    actor,
    activeCouponId: row.id,
    productId: row.product_id,
  });
  return { ok: true };
}

// --- 7. Auto-approve flow (used by cron when plan.require_manual_approval=false)
// Walks pending rows for plans flagged auto-approve and calls approveCoupon for each.

export async function autoApprovePendingForAutoPlans(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("promo_active_coupons")
    .select("id, plan_id, promo_coupon_plans!inner(require_manual_approval, enabled)")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending");
  if (!rows) return 0;
  let approved = 0;
  for (const row of rows as unknown as Array<{
    id: string;
    promo_coupon_plans: { require_manual_approval: boolean; enabled: boolean } | Array<{ require_manual_approval: boolean; enabled: boolean }>;
  }>) {
    // PostgREST returns the joined object as an array if the relationship is
    // ambiguous, otherwise as a single object. Normalize.
    const plan = Array.isArray(row.promo_coupon_plans)
      ? row.promo_coupon_plans[0]
      : row.promo_coupon_plans;
    if (!plan || plan.require_manual_approval || !plan.enabled) continue;
    const r = await approveCoupon(workspaceId, row.id, "cron-auto-approve");
    if (r.ok) approved++;
  }
  return approved;
}
