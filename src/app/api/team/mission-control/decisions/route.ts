import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { listDecisions, saveDecision } from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const decisions = await listDecisions(ctx.supabase, ctx.workspaceId);
    return NextResponse.json({ decisions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const decision = await saveDecision(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ decision }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
