import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { enqueueNotification, listNotifications } from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const url = new URL(request.url);
    const notifications = await listNotifications(ctx.supabase, ctx.workspaceId, {
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : 200,
    });
    return NextResponse.json({ notifications });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    if (!body.entity_type || !body.event) {
      return NextResponse.json(
        { error: "entity_type and event required" },
        { status: 400 }
      );
    }
    const notification = await enqueueNotification(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ notification }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
