import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { listLearnings, saveLearning } from "@/lib/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const learnings = await listLearnings(ctx.supabase, ctx.workspaceId);
    return NextResponse.json({ learnings });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const learning = await saveLearning(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ learning }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
