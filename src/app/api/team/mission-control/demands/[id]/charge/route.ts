import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireWorkspace,
} from "@/lib/team/mission-control/route-helpers";
import { chargePerson } from "@/lib/team/mission-control/db";

// POST /api/team/mission-control/demands/[id]/charge
// Body: { target_person?: string, message_text?: string }
// Defaults target to the demand's waiting_for_person (falls back to owner).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireWorkspace(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json().catch(() => ({}));
    const followUp = await chargePerson(
      ctx.supabase,
      ctx.workspaceId,
      id,
      {
        targetPerson: body.target_person,
        messageText: body.message_text,
      },
      ctx.actor
    );
    return NextResponse.json({ followUp }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
