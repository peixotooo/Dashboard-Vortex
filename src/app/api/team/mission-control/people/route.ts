import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { listPeople, savePerson } from "@/lib/team/mission-control/db";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const url = new URL(request.url);
    const people = await listPeople(ctx.supabase, ctx.workspaceId, {
      activeOnly: url.searchParams.get("active") === "1",
    });
    return NextResponse.json({ people });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    if (!body.name)
      return NextResponse.json({ error: "name required" }, { status: 400 });
    const person = await savePerson(ctx.supabase, ctx.workspaceId, body);
    return NextResponse.json({ person }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
