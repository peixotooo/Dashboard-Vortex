import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { enqueueCouponPlanRunJob } from "@/lib/coupons/jobs";

// POST /api/coupons/plans/[id]/run — queues the orchestrator for THIS plan.
// The dedicated worker processes the job so coupon/VNDA mass actions never run
// in the user request.
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const playbookContext = {
      playbook_run_id: typeof body?.playbook_run_id === "string" ? body.playbook_run_id : null,
      playbook_id: typeof body?.playbook_id === "string" ? body.playbook_id : null,
      playbook_name: typeof body?.playbook_name === "string" ? body.playbook_name : null,
    };
    const hasPlaybookContext = Boolean(playbookContext.playbook_run_id);

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
      const queued = await enqueueCouponPlanRunJob({
        admin,
        workspaceId,
        planId: id,
        requestedBy: userId,
        ...(hasPlaybookContext ? { playbookContext } : {}),
      });
      return NextResponse.json({
        ok: true,
        queued: true,
        job_id: queued.jobId,
        job_status: queued.status,
        already_queued: queued.alreadyQueued,
        plan_name: plan.name,
        require_manual_approval: plan.require_manual_approval,
        playbook_run_id: playbookContext.playbook_run_id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (error) {
    return handleAuthError(error);
  }
}
