import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import {
  buildCooReviewBuckets,
  sweepOverdueFollowUps,
} from "@/lib/team/mission-control/db";
import type {
  Demand,
  FollowUp,
  Priority,
} from "@/lib/team/mission-control/types";

// Dedicated endpoint for the COO Review home. Returns the five buckets that
// together make up the morning scan.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    await sweepOverdueFollowUps(ctx.supabase, ctx.workspaceId);

    const [demandsRes, followsRes, expRes] = await Promise.all([
      ctx.supabase.from("mc_demands").select("*").eq("workspace_id", ctx.workspaceId),
      ctx.supabase
        .from("mc_follow_ups")
        .select("*")
        .eq("workspace_id", ctx.workspaceId)
        .in("reply_status", ["no_reply", "pending"]),
      ctx.supabase
        .from("mc_experiments")
        .select("id, title, status, priority, updated_at, decision")
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "analyzing"),
    ]);

    const buckets = buildCooReviewBuckets({
      demands: (demandsRes.data ?? []) as Demand[],
      follows: (followsRes.data ?? []) as FollowUp[],
      experimentsAnalyzing: (expRes.data ?? []) as Array<{
        id: string;
        title: string;
        priority: Priority;
        updated_at: string;
        decision: string | null;
      }>,
      now: Date.now(),
    });

    return NextResponse.json({ review: buckets });
  } catch (err) {
    return errorResponse(err);
  }
}
