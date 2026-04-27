import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCouponSettings } from "@/lib/coupons/settings";
import { logCouponAudit } from "@/lib/coupons/audit";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

async function authed(request: NextRequest) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 } as const;
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return { error: "Workspace not specified", status: 400 } as const;
  return { user, workspaceId } as const;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await authed(request);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const body = await request.json();

  const settings = await getCouponSettings(ctx.workspaceId);
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
    "badge_template", "badge_bg_color", "badge_text_color",
  ]) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("promo_coupon_plans")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logCouponAudit({
    workspaceId: ctx.workspaceId,
    action: body.enabled === false ? "plan_disabled" : "plan_updated",
    actor: ctx.user.id,
    planId: id,
    details: update as Record<string, unknown>,
  });
  return NextResponse.json({ plan: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await authed(request);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const admin = createAdminClient();
  // Soft "disable" instead of delete to preserve audit history references
  await admin
    .from("promo_coupon_plans")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);
  await logCouponAudit({
    workspaceId: ctx.workspaceId,
    action: "plan_disabled",
    actor: ctx.user.id,
    planId: id,
  });
  return NextResponse.json({ ok: true });
}
