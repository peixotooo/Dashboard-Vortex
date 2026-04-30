// src/app/api/crm/email-templates/[id]/select/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { logAudit } from "@/lib/email-templates/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;

    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("email_template_suggestions")
      .select("id, status, selected_count, selected_at")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const now = new Date().toISOString();
    const newCount = (existing.selected_count ?? 0) + 1;
    const newStatus = existing.status === "sent" ? "sent" : "selected";

    const { data, error } = await supabase
      .from("email_template_suggestions")
      .update({
        status: newStatus,
        selected_count: newCount,
        selected_at: existing.selected_at ?? now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("id, selected_at, selected_count, status")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAudit({
      workspace_id: workspaceId,
      suggestion_id: id,
      event: "selected",
      payload: { count: newCount },
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return handleAuthError(err);
  }
}
