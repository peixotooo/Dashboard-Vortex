import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { chargePricila } from "@/lib/mission-control/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const followUp = await chargePricila(ctx.supabase, ctx.workspaceId, id, ctx.actor);
    return NextResponse.json({ followUp }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
