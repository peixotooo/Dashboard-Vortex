import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { dashboardSummary } from "@/lib/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const summary = await dashboardSummary(ctx.supabase, ctx.workspaceId);
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err);
  }
}
