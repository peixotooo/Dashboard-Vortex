// src/app/api/crm/email-templates/[id]/sent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { logAudit } from "@/lib/email-templates/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getAuthenticatedContext(req);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const sent_at = body.sent_at ? new Date(body.sent_at) : new Date();
    if (Number.isNaN(sent_at.getTime())) {
      return NextResponse.json({ error: "invalid_sent_at" }, { status: 400 });
    }
    const hour_chosen = body.hour_chosen != null ? Number(body.hour_chosen) : null;
    if (
      hour_chosen != null &&
      (hour_chosen < 0 || hour_chosen > 23 || !Number.isInteger(hour_chosen))
    ) {
      return NextResponse.json({ error: "invalid_hour_chosen" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_template_suggestions")
      .update({
        status: "sent",
        sent_at: sent_at.toISOString(),
        sent_hour_chosen: hour_chosen,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("id, sent_at, sent_hour_chosen, status")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAudit({
      workspace_id: workspaceId,
      suggestion_id: id,
      event: "sent",
      payload: { hour_chosen },
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return handleAuthError(err);
  }
}
