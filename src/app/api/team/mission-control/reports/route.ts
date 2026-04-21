import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { listReports, saveReport } from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const reports = await listReports(ctx.supabase, ctx.workspaceId);
    return NextResponse.json({ reports });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const report = await saveReport(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ report }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
