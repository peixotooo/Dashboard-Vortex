import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { proposeNewCoupons, autoApprovePendingForAutoPlans } from "@/lib/coupons/orchestrator";

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

// POST /api/coupons/plans/[id]/run — runs the orchestrator immediately for
// THIS plan only. Useful when you don't want to wait for the daily cron.
// Respects the plan's require_manual_approval flag — pending rows still need
// approval from the painel unless the plan is on auto-approve.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { id } = await params;

  // Verify the plan belongs to this workspace and is enabled
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("promo_coupon_plans")
    .select("id, enabled, name, require_manual_approval")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();
  if (!plan) return NextResponse.json({ error: "Plano nao encontrado" }, { status: 404 });
  if (!plan.enabled) return NextResponse.json({ error: "Plano desabilitado" }, { status: 400 });

  try {
    const t0 = Date.now();
    const results = await proposeNewCoupons(workspaceId, { onlyPlanIds: [id] });
    const proposed = results.reduce((s, r) => s + r.inserted, 0);
    let autoApproved = 0;
    // If the plan has auto-approve, run it now so user sees them as 'active'
    if (!plan.require_manual_approval) {
      autoApproved = await autoApprovePendingForAutoPlans(workspaceId);
    }
    return NextResponse.json({
      ok: true,
      plan_name: plan.name,
      proposed,
      auto_approved: autoApproved,
      require_manual_approval: plan.require_manual_approval,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
