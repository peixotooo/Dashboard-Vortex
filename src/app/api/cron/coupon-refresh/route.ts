import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  expireOldCoupons,
  cancelStalePending,
  proposeNewCoupons,
  autoApprovePendingForAutoPlans,
} from "@/lib/coupons/orchestrator";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find every workspace that has at least one enabled coupon plan
  const { data: planRows } = await admin
    .from("promo_coupon_plans")
    .select("workspace_id")
    .eq("enabled", true);
  const workspaceIds = Array.from(new Set((planRows || []).map((r) => r.workspace_id as string)));
  if (workspaceIds.length === 0) {
    return NextResponse.json({ processed: 0, message: "No enabled coupon plans" });
  }

  const summary: Array<{
    workspaceId: string;
    expired: number;
    pendingCancelled: number;
    proposed: number;
    autoApproved: number;
    error?: string;
  }> = [];

  for (const wsId of workspaceIds) {
    try {
      const expired = await expireOldCoupons(wsId);
      const pendingCancelled = await cancelStalePending(wsId);
      const propResults = await proposeNewCoupons(wsId);
      const proposed = propResults.reduce((s, r) => s + r.inserted, 0);
      const autoApproved = await autoApprovePendingForAutoPlans(wsId);
      summary.push({ workspaceId: wsId, expired, pendingCancelled, proposed, autoApproved });
      console.log(
        `[CouponRefresh] ws=${wsId} expired=${expired} cancelled_pending=${pendingCancelled} proposed=${proposed} auto_approved=${autoApproved}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.push({ workspaceId: wsId, expired: 0, pendingCancelled: 0, proposed: 0, autoApproved: 0, error: msg });
      console.error(`[CouponRefresh] ws=${wsId} failed:`, msg);
    }
  }

  return NextResponse.json({ processed: summary.length, summary });
}
