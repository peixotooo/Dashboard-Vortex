import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { markNotification } from "@/lib/team/mission-control/db";

// PATCH to mark a queued notification sent/failed/skipped. Workers call this.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const notification = await markNotification(
      ctx.supabase,
      ctx.workspaceId,
      id,
      body
    );
    return NextResponse.json({ notification });
  } catch (err) {
    return errorResponse(err);
  }
}
