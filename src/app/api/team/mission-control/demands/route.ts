import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import {
  createDemand,
  listDemands,
  sweepOverdueFollowUps,
} from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;

    await sweepOverdueFollowUps(ctx.supabase, ctx.workspaceId);

    const url = new URL(request.url);
    const demands = await listDemands(ctx.supabase, ctx.workspaceId, {
      status: url.searchParams.get("status") || undefined,
      area: url.searchParams.get("area") || undefined,
      owner: url.searchParams.get("owner") || undefined,
      priority: url.searchParams.get("priority") || undefined,
      waitingForPerson: url.searchParams.get("waiting_for") || undefined,
      waitingForAny: url.searchParams.get("waiting") === "1",
      blocked: url.searchParams.get("blocked") === "1",
      search: url.searchParams.get("q") || undefined,
    });
    return NextResponse.json({ demands });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const demand = await createDemand(ctx.supabase, ctx.workspaceId, body, ctx.actor);
    return NextResponse.json({ demand }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
