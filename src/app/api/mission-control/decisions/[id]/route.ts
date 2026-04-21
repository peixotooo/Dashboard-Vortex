import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { deleteDecision, saveDecision } from "@/lib/mission-control/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const decision = await saveDecision(ctx.supabase, ctx.workspaceId, {
      ...body,
      id,
    });
    return NextResponse.json({ decision });
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
    await deleteDecision(ctx.supabase, ctx.workspaceId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
