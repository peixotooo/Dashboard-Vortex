import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/mission-control/route-helpers";
import { listActivity } from "@/lib/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const url = new URL(request.url);
    const activity = await listActivity(ctx.supabase, ctx.workspaceId, {
      demandId: url.searchParams.get("demand_id") || undefined,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : 200,
    });
    return NextResponse.json({ activity });
  } catch (err) {
    return errorResponse(err);
  }
}
