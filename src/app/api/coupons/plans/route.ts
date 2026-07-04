import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCouponSettings } from "@/lib/coupons/settings";
import { logCouponAudit } from "@/lib/coupons/audit";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("promo_coupon_plans")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plans: data || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const body = await request.json();
    const settings = await getCouponSettings(workspaceId);

  // Validations
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name obrigatorio" }, { status: 400 });
  }
  const min = Number(body.discount_min_pct);
  const max = Number(body.discount_max_pct);
  if (!Number.isFinite(min) || min <= 0) return NextResponse.json({ error: "discount_min_pct invalido" }, { status: 400 });
  if (!Number.isFinite(max) || max < min) return NextResponse.json({ error: "discount_max_pct invalido" }, { status: 400 });
  if (max > settings.global_max_discount_pct) {
    return NextResponse.json(
      { error: `discount_max_pct (${max}%) excede o cap do workspace (${settings.global_max_discount_pct}%)` },
      { status: 400 }
    );
  }

  const mode = body.mode || "one_shot";
  // Smart mode is fully autonomous — manual approval is forbidden by design.
  const requireManualApproval = mode === "smart" ? false : body.require_manual_approval !== false;
  const discountUnit = ["pct", "brl", "auto"].includes(body.discount_unit) ? body.discount_unit : "pct";
  const cooldownDays = Math.max(0, Math.min(90, Number(body.cooldown_days) || 7));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("promo_coupon_plans")
    .insert({
      workspace_id: workspaceId,
      name: body.name,
      enabled: body.enabled ?? true,
      mode,
      target: body.target || "low_cvr_high_views",
      manual_product_ids: body.manual_product_ids || null,
      discount_min_pct: min,
      discount_max_pct: max,
      duration_hours: Number(body.duration_hours) || 48,
      max_active_products: Number(body.max_active_products) || 5,
      recurring_cron: body.recurring_cron || null,
      require_manual_approval: requireManualApproval,
      discount_unit: discountUnit,
      cooldown_days: cooldownDays,
      badge_template: body.badge_template || "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}",
      badge_bg_color: body.badge_bg_color || "#dc2626",
      badge_text_color: body.badge_text_color || "#ffffff",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const playbookContext = {
    playbook_id: typeof body.playbook_id === "string" ? body.playbook_id : null,
    playbook_run_id: typeof body.playbook_run_id === "string" ? body.playbook_run_id : null,
    playbook_name: typeof body.playbook_name === "string" ? body.playbook_name : null,
  };
    await logCouponAudit({
      workspaceId: workspaceId,
      action: "plan_created",
      actor: userId,
      planId: data.id,
      details: {
        name: data.name,
        mode: data.mode,
        target: data.target,
        ...(playbookContext.playbook_run_id ? playbookContext : {}),
      },
    });
    return NextResponse.json({ plan: data });
  } catch (error) {
    return handleAuthError(error);
  }
}
