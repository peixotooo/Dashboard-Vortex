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
  removeVndaProductRule,
  createPromotionBucket,
  addCodeToBucket,
  VndaError,
  type VndaConfig,
} from "./vnda-coupons";
import { chooseUnitFromBandit } from "./bandit";
import { getDemandSignal } from "./demand";

// --- Types from DB rows we touch ---

interface PlanRow {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  mode: "one_shot" | "recurring" | "smart";
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  manual_product_ids: string[] | null;
  discount_min_pct: number;
  discount_max_pct: number;
  duration_hours: number;
  max_active_products: number;
  recurring_cron: string | null;
  recurring_last_run_at: string | null;
  require_manual_approval: boolean;
  discount_unit: "pct" | "brl" | "auto";
  cooldown_days: number;
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

// --- Helpers ---

/**
 * Surgical pause for a single coupon. Removes ONLY the product binding (rule)
 * for this coupon, leaving the discount and other coupons in the same bucket
 * intact. Falls back to pausing the whole discount when:
 *   - the row has no vnda_rule_id (legacy data), OR
 *   - this is the last live coupon under the discount (nothing left to keep up).
 *
 * Returns the action taken so callers can audit.
 */
async function pauseCouponSurgical(
  config: VndaConfig,
  workspaceId: string,
  row: { id: string; vnda_discount_id: number | null; vnda_rule_id?: number | null }
): Promise<"rule_removed" | "discount_paused" | "noop"> {
  if (!row.vnda_discount_id) return "noop";

  const admin = createAdminClient();
  // Count siblings still in non-terminal status sharing the same discount
  const { count: siblingsActive } = await admin
    .from("promo_active_coupons")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("vnda_discount_id", row.vnda_discount_id)
    .neq("id", row.id)
    .in("status", ["active", "pending"]);

  if (row.vnda_rule_id && (siblingsActive ?? 0) > 0) {
    await removeVndaProductRule(config, row.vnda_discount_id, row.vnda_rule_id);
    return "rule_removed";
  }

  // Last man standing — safe to pause the whole discount
  await pauseVndaPromotion(config, row.vnda_discount_id);
  return "discount_paused";
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

  // Refetch with rule_id for surgical pause
  const { data: dueWithRule } = await admin
    .from("promo_active_coupons")
    .select("id, plan_id, product_id, vnda_discount_id, vnda_rule_id, vnda_coupon_code")
    .in("id", due.map((d) => d.id));

  for (const row of dueWithRule || []) {
    // Pause on VNDA first; if it fails, keep DB as active so we retry next cycle
    if (config && row.vnda_discount_id) {
      await logCouponAudit({
        workspaceId,
        action: "vnda_pause_attempt",
        actor: "cron",
        planId: row.plan_id || undefined,
        activeCouponId: row.id,
        productId: row.product_id,
        details: { promotion_id: row.vnda_discount_id, rule_id: row.vnda_rule_id, reason: "expired" },
      });
      try {
        const action = await pauseCouponSurgical(config, workspaceId, row);
        await logCouponAudit({
          workspaceId,
          action: "vnda_pause_ok",
          actor: "cron",
          activeCouponId: row.id,
          productId: row.product_id,
          details: { strategy: action },
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
  const liveProductIds = new Set((live || []).map((l) => l.product_id));
  const workspaceActiveCount = (live || []).length;

  // Demand signal — same for all plans this run
  const demandSignal = await getDemandSignal(workspaceId);

  const results: ProposeResult[] = [];

  for (const plan of plans as PlanRow[]) {
    // Smart plans pace themselves at 24h regardless of recurring_cron value
    // (so the daily attribution → bandit → next pick loop has time to settle).
    // Manual "Rodar agora" via onlyPlanIds bypasses this cap.
    if (plan.mode === "smart" && !options.onlyPlanIds && plan.recurring_last_run_at) {
      const sinceMs = Date.now() - new Date(plan.recurring_last_run_at).getTime();
      if (sinceMs < 23 * 3600_000) {
        await logCouponAudit({
          workspaceId,
          action: "cron_skipped",
          actor: "cron",
          planId: plan.id,
          details: { reason: "smart_24h_throttle", last_run: plan.recurring_last_run_at },
        });
        results.push({ planId: plan.id, inserted: 0, skipped: 0 });
        continue;
      }
    }

    // Cooldown: also exclude products that had ANY coupon (active/expired/cancelled)
    // within the plan's cooldown window. Default 7 days if missing.
    const cooldownDays = Math.max(0, Number(plan.cooldown_days) || 7);
    const excludeProductIds = new Set(liveProductIds);
    if (cooldownDays > 0) {
      const cutoff = new Date(Date.now() - cooldownDays * 24 * 3600_000).toISOString();
      const { data: recent } = await admin
        .from("promo_active_coupons")
        .select("product_id")
        .eq("workspace_id", workspaceId)
        .in("status", ["active", "expired", "cancelled", "paused", "pending"])
        .gte("created_at", cutoff);
      for (const r of recent || []) excludeProductIds.add(r.product_id);
    }

    // Resolve discount unit: 'auto' → bandit; otherwise the plan's choice
    let unit: "pct" | "brl" = (plan.discount_unit as "pct" | "brl") || "pct";
    let banditReason = "configured";
    if (plan.discount_unit === "auto") {
      const choice = await chooseUnitFromBandit(workspaceId);
      unit = choice.unit;
      banditReason = choice.reason;
    }

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
      discountUnit: unit,
      demandModifier: demandSignal.modifier,
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
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateCouponCode(pick.product_id, pick.discount_pct);
        const { error } = await admin.from("promo_active_coupons").insert({
          workspace_id: workspaceId,
          plan_id: plan.id,
          product_id: pick.product_id,
          vnda_coupon_code: code,
          discount_pct: pick.discount_pct,
          discount_unit: pick.discount_unit,
          discount_value_brl: pick.discount_value_brl ?? null,
          starts_at: startsAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          status: "pending",
        });
        if (!error) {
          inserted++;
          break;
        }
        if (!error.message.toLowerCase().includes("unique")) {
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
      await logCouponAudit({
        workspaceId,
        action: "cron_picked",
        actor: "cron",
        planId: plan.id,
        productId: pick.product_id,
        details: {
          discount_pct: pick.discount_pct,
          discount_unit: pick.discount_unit,
          discount_value_brl: pick.discount_value_brl ?? null,
          score: pick.low_rotation_score,
          tier: pick.abc_tier,
          views: pick.views,
          cvr: pick.cvr,
          coupon_code: code,
          require_manual_approval: plan.require_manual_approval,
          unit_chosen_by: banditReason,
          demand_modifier: demandSignal.modifier,
          demand_reason: demandSignal.reason,
          cooldown_days: cooldownDays,
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
//
// Optional `bucket` arg lets the caller batch multiple approvals into ONE
// VNDA promotion (1 promo + N rules + N codes) instead of creating a new
// promotion per coupon. Used by autoApprovePendingForAutoPlans().
//
// When bucket is provided, this function:
//  - skips createFullCoupon and instead calls addCodeToBucket with the
//    bucket.promotionId
//  - reuses the bucket for vnda_discount_id

export async function approveCoupon(
  workspaceId: string,
  couponId: string,
  actor: string,
  bucket?: { promotionId: number; config: VndaConfig }
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

  const config = bucket?.config || (await getVndaConfigForWorkspace(workspaceId));
  if (!config) return { ok: false, error: "VNDA nao configurada" };

  const settings = await getCouponSettings(workspaceId);

  // discount_unit + discount_value_brl may not exist on legacy rows — default to pct.
  // In a shared bucket we ALWAYS force "pct" — fixed BRL rules combined with
  // a non-cumulative bucket cause customer-facing price increases when the
  // product already has a sale_price (VNDA discards the sale and applies the
  // fixed off the regular price). Percentages always discount on top of
  // whatever the customer is currently seeing.
  const dbUnit = ((row as Record<string, unknown>).discount_unit as "pct" | "brl" | undefined) || "pct";
  const discountUnit: "pct" | "brl" = bucket ? "pct" : dbUnit;
  const valueBrl = (row as Record<string, unknown>).discount_value_brl as number | null | undefined;
  const amount = discountUnit === "brl" && valueBrl ? Number(valueBrl) : Number(row.discount_pct);

  await logCouponAudit({
    workspaceId,
    action: "vnda_create_attempt",
    actor,
    activeCouponId: row.id,
    productId: row.product_id,
    details: {
      coupon_code: row.vnda_coupon_code,
      discount_pct: row.discount_pct,
      discount_unit: discountUnit,
      amount,
      bucket_promotion_id: bucket?.promotionId || null,
    },
  });

  try {
    let promotionId: number;
    let ruleId: number;
    if (bucket) {
      // Reuse existing bucket — just add the rule + code
      const r = await addCodeToBucket(config, bucket.promotionId, {
        code: row.vnda_coupon_code,
        product_id: row.product_id,
        amount,
        discount_unit: discountUnit,
        uses_per_code: settings.default_uses_per_code,
        uses_per_user: settings.default_uses_per_user,
      });
      promotionId = bucket.promotionId;
      ruleId = r.rule_id;
      await logCouponAudit({
        workspaceId,
        action: "bucket_reused",
        actor,
        activeCouponId: row.id,
        productId: row.product_id,
        details: { bucket_promotion_id: promotionId, rule_id: ruleId },
      });
    } else {
      const result = await createFullCoupon(config, {
        name: `Vortex ${row.vnda_coupon_code} (${prod.name?.slice(0, 40) || row.product_id})`,
        code: row.vnda_coupon_code,
        product_id: row.product_id,
        amount,
        discount_unit: discountUnit,
        starts_at: new Date(row.starts_at),
        expires_at: new Date(row.expires_at),
        cumulative: settings.cumulative_with_other_promos,
        uses_per_code: settings.default_uses_per_code,
        uses_per_user: settings.default_uses_per_user,
      });
      promotionId = result.promotion_id;
      ruleId = result.rule_id;
    }

    await admin
      .from("promo_active_coupons")
      .update({
        status: "active",
        vnda_discount_id: promotionId,
        vnda_rule_id: ruleId,
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
      details: { promotion_id: promotionId, rule_id: ruleId, bucket: !!bucket },
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
  let pauseStrategy: "rule_removed" | "discount_paused" | "noop" = "noop";
  if (config && row.vnda_discount_id) {
    try {
      pauseStrategy = await pauseCouponSurgical(config, workspaceId, row);
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
    .update({ status: "paused", status_reason: `manual_${pauseStrategy}` })
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
  // Pull pending rows joined to their plan so we can filter and group them
  const { data: rows } = await admin
    .from("promo_active_coupons")
    .select(
      "id, plan_id, expires_at, starts_at, promo_coupon_plans!inner(name, require_manual_approval, enabled)"
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "pending");
  if (!rows || rows.length === 0) return 0;

  type PendingRow = {
    id: string;
    plan_id: string | null;
    expires_at: string;
    starts_at: string;
    promo_coupon_plans:
      | { name: string; require_manual_approval: boolean; enabled: boolean }
      | Array<{ name: string; require_manual_approval: boolean; enabled: boolean }>;
  };
  const eligible: Array<{
    id: string;
    plan_id: string | null;
    plan_name: string;
    starts_at: string;
    expires_at: string;
  }> = [];
  for (const row of rows as unknown as PendingRow[]) {
    const plan = Array.isArray(row.promo_coupon_plans) ? row.promo_coupon_plans[0] : row.promo_coupon_plans;
    if (!plan || plan.require_manual_approval || !plan.enabled) continue;
    eligible.push({
      id: row.id,
      plan_id: row.plan_id,
      plan_name: plan.name,
      starts_at: row.starts_at,
      expires_at: row.expires_at,
    });
  }
  if (eligible.length === 0) return 0;

  // Group by (plan_id + expires_at) — every coupon that shares those two fields
  // can live under a single VNDA promotion (1 promo + N rules + N codes).
  const buckets = new Map<string, typeof eligible>();
  for (const e of eligible) {
    const key = `${e.plan_id || "no-plan"}::${e.expires_at}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }

  // Pull VNDA config + settings once — reused across every approve in every bucket
  const config = await getVndaConfigForWorkspace(workspaceId);
  const settings = await getCouponSettings(workspaceId);
  if (!config) {
    // Fallback: approve one-by-one without bucket so each call surfaces its own error
    let approved = 0;
    for (const e of eligible) {
      const r = await approveCoupon(workspaceId, e.id, "cron-auto-approve");
      if (r.ok) approved++;
    }
    return approved;
  }

  let approvedTotal = 0;
  for (const [, bucketRows] of buckets.entries()) {
    if (bucketRows.length === 0) continue;
    const head = bucketRows[0];

    // Single-coupon bucket: skip the bucket dance, just create a regular promo
    if (bucketRows.length === 1) {
      const r = await approveCoupon(workspaceId, head.id, "cron-auto-approve");
      if (r.ok) approvedTotal++;
      continue;
    }

    // Multi-coupon: create one parent promotion, then add each code to it.
    // cumulative respects the workspace setting so the bucket behaves the
    // same way as single-coupon promotions.
    let promo;
    try {
      promo = await createPromotionBucket(config, {
        name: `Vortex bucket ${head.plan_name} (${bucketRows.length} produtos)`,
        starts_at: new Date(head.starts_at),
        expires_at: new Date(head.expires_at),
        cumulative: settings.cumulative_with_other_promos,
        description: `Auto-bucket de ${bucketRows.length} cupons do plano ${head.plan_name}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Orchestrator] bucket creation failed for plan ${head.plan_name}:`, msg);
      // Fallback: approve one-by-one
      for (const r of bucketRows) {
        const ar = await approveCoupon(workspaceId, r.id, "cron-auto-approve");
        if (ar.ok) approvedTotal++;
      }
      continue;
    }

    for (const r of bucketRows) {
      const ar = await approveCoupon(workspaceId, r.id, "cron-auto-approve", {
        promotionId: promo.id,
        config,
      });
      if (ar.ok) approvedTotal++;
    }
  }
  return approvedTotal;
}
