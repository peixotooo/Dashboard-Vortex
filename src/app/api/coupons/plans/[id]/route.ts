import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCouponSettings } from "@/lib/coupons/settings";
import { logCouponAudit } from "@/lib/coupons/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);
    const { id } = await params;
    const body = await request.json();

    const settings = await getCouponSettings(workspaceId);
  if (body.discount_max_pct !== undefined) {
    const max = Number(body.discount_max_pct);
    if (!Number.isFinite(max) || max <= 0) return NextResponse.json({ error: "discount_max_pct invalido" }, { status: 400 });
    if (max > settings.global_max_discount_pct) {
      return NextResponse.json(
        { error: `discount_max_pct excede o cap do workspace (${settings.global_max_discount_pct}%)` },
        { status: 400 }
      );
    }
  }

  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  for (const k of [
    "name", "enabled", "mode", "target", "manual_product_ids",
    "discount_min_pct", "discount_max_pct",
    "duration_hours", "max_active_products",
    "recurring_cron", "require_manual_approval",
    "discount_unit", "cooldown_days",
    "badge_template", "badge_bg_color", "badge_text_color",
  ]) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  // Smart mode: cannot require manual approval. Force false at write time.
  if (update.mode === "smart" || (update.mode === undefined && body.require_manual_approval === false)) {
    if (update.mode === "smart") update.require_manual_approval = false;
  }
  if (update.cooldown_days !== undefined) {
    const c = Number(update.cooldown_days);
    if (!Number.isFinite(c) || c < 0 || c > 90) {
      return NextResponse.json({ error: "cooldown_days deve estar entre 0 e 90" }, { status: 400 });
    }
  }
  if (update.discount_unit !== undefined && !["pct", "brl", "auto"].includes(String(update.discount_unit))) {
    return NextResponse.json({ error: "discount_unit deve ser pct, brl ou auto" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("promo_coupon_plans")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logCouponAudit({
    workspaceId: workspaceId,
    action: body.enabled === false ? "plan_disabled" : "plan_updated",
    actor: userId,
    planId: id,
    details: update as Record<string, unknown>,
  });
    return NextResponse.json({ plan: data });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);
    const { id } = await params;
    const admin = createAdminClient();
    // Soft "disable" instead of delete to preserve audit history references
    await admin
      .from("promo_coupon_plans")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    await logCouponAudit({
      workspaceId: workspaceId,
      action: "plan_disabled",
      actor: userId,
      planId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
