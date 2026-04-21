import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { updateFollowUp } from "@/lib/team/mission-control/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const followUp = await updateFollowUp(
      ctx.supabase,
      ctx.workspaceId,
      id,
      body,
      ctx.actor
    );
    return NextResponse.json({ followUp });
  } catch (err) {
    return errorResponse(err);
  }
}
