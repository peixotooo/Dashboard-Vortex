import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import {
  deleteDemand,
  getDemand,
  listActivity,
  listFollowUps,
  updateDemand,
} from "@/lib/mission-control/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;

    const demand = await getDemand(ctx.supabase, id);
    if (!demand || demand.workspace_id !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [followUps, activity] = await Promise.all([
      listFollowUps(ctx.supabase, ctx.workspaceId, { demandId: id }),
      listActivity(ctx.supabase, ctx.workspaceId, { demandId: id }),
    ]);
    return NextResponse.json({ demand, followUps, activity });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const demand = await updateDemand(ctx.supabase, ctx.workspaceId, id, body, ctx.actor);
    return NextResponse.json({ demand });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    await deleteDemand(ctx.supabase, ctx.workspaceId, id, ctx.actor);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
