import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { listExperiments, saveExperiment } from "@/lib/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const url = new URL(request.url);
    const experiments = await listExperiments(ctx.supabase, ctx.workspaceId, {
      status: url.searchParams.get("status") || undefined,
      area: url.searchParams.get("area") || undefined,
    });
    return NextResponse.json({ experiments });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const experiment = await saveExperiment(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ experiment }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
