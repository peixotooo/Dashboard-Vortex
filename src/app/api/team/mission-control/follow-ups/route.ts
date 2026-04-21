import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import {
  createFollowUp,
  listFollowUps,
  sweepOverdueFollowUps,
} from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    await sweepOverdueFollowUps(ctx.supabase, ctx.workspaceId);

    const url = new URL(request.url);
    const followUps = await listFollowUps(ctx.supabase, ctx.workspaceId, {
      demandId: url.searchParams.get("demand_id") || undefined,
      replyStatus: url.searchParams.get("reply_status") || undefined,
    });
    return NextResponse.json({ followUps });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    if (!body.target_person) {
      return NextResponse.json({ error: "target_person required" }, { status: 400 });
    }
    const followUp = await createFollowUp(ctx.supabase, ctx.workspaceId, body, ctx.actor);
    return NextResponse.json({ followUp }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
