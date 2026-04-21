import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { deleteLearning, saveLearning } from "@/lib/team/mission-control/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const learning = await saveLearning(ctx.supabase, ctx.workspaceId, {
      ...body,
      id,
    });
    return NextResponse.json({ learning });
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
    await deleteLearning(ctx.supabase, ctx.workspaceId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
