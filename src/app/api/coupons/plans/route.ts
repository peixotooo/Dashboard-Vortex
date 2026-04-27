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

export async function GET(request: NextRequest) {
  const ctx = await authed(request);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("promo_coupon_plans")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plans: data || [] });
}

export async function POST(request: NextRequest) {
  const ctx = await authed(request);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await request.json();
  const settings = await getCouponSettings(ctx.workspaceId);

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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("promo_coupon_plans")
    .insert({
      workspace_id: ctx.workspaceId,
      name: body.name,
      enabled: body.enabled ?? true,
      mode: body.mode || "one_shot",
      target: body.target || "low_cvr_high_views",
      manual_product_ids: body.manual_product_ids || null,
      discount_min_pct: min,
      discount_max_pct: max,
      duration_hours: Number(body.duration_hours) || 48,
      max_active_products: Number(body.max_active_products) || 5,
      recurring_cron: body.recurring_cron || null,
      require_manual_approval: body.require_manual_approval !== false,
      badge_template: body.badge_template || "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}",
      badge_bg_color: body.badge_bg_color || "#dc2626",
      badge_text_color: body.badge_text_color || "#ffffff",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logCouponAudit({
    workspaceId: ctx.workspaceId,
    action: "plan_created",
    actor: ctx.user.id,
    planId: data.id,
    details: { name: data.name, mode: data.mode, target: data.target },
  });
  return NextResponse.json({ plan: data });
}
