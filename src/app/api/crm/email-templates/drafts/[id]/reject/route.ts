// src/app/api/crm/email-templates/drafts/[id]/reject/route.ts
//
// Rejeita um draft em pending_approval. Marca approval_state='rejected'
// mas mantém o dispatch_payload pra que o autor possa editar e reenviar.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

interface Body {
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Body;
    const sb = createAdminClient();

    const { data: draft, error: dErr } = await sb
      .from("email_template_drafts")
      .select("id, approval_state")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    if (!draft) {
      return NextResponse.json({ error: "Draft não encontrado." }, { status: 404 });
    }
    if (draft.approval_state !== "pending_approval") {
      return NextResponse.json(
        { error: "Esse draft não está pendente de aprovação." },
        { status: 400 }
      );
    }

    const { error: upErr } = await sb
      .from("email_template_drafts")
      .update({
        approval_state: "rejected",
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        rejection_reason: body.reason?.trim() || null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
