// src/app/api/crm/email-templates/drafts/[id]/approve/route.ts
//
// Aprova um draft em pending_approval e dispara o envio pra Locaweb usando
// o dispatch_payload + scheduled_for que foram salvos no momento da
// submissão. Mesmo usuário que submeteu pode aprovar (decisão do produto —
// usuários revisam o próprio trabalho quando querem o gate sem precisar
// de uma segunda pessoa).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { dispatchDraft, type DispatchPayload } from "@/lib/email-templates/dispatch-core";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(req);
    const { id } = await params;
    const sb = createAdminClient();

    const { data: draft, error: dErr } = await sb
      .from("email_template_drafts")
      .select(
        "id, approval_state, dispatch_payload, scheduled_for, submitted_by"
      )
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
    const payload = draft.dispatch_payload as DispatchPayload | null;
    if (!payload || !Array.isArray(payload.list_ids) || payload.list_ids.length === 0) {
      return NextResponse.json(
        {
          error:
            "Esse draft não tem configuração de envio salva. Volte e reenvie pra aprovação.",
        },
        { status: 400 }
      );
    }

    // Marca aprovação ANTES de chamar Locaweb pra evitar dupla aprovação
    // concorrente. Se a Locaweb falhar, revertemos.
    const now = new Date().toISOString();
    const { error: lockErr } = await sb
      .from("email_template_drafts")
      .update({ approval_state: "approved", approved_by: userId, approved_at: now })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .eq("approval_state", "pending_approval");
    if (lockErr) {
      return NextResponse.json({ error: lockErr.message }, { status: 500 });
    }

    const result = await dispatchDraft(sb, workspaceId, id, payload);
    if (!result.ok) {
      // Reverte aprovação pra permitir retry.
      await sb
        .from("email_template_drafts")
        .update({ approval_state: "pending_approval", approved_by: null, approved_at: null })
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      return NextResponse.json(
        { error: result.error, status: result.status, warn: result.warn },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({
      ok: true,
      dispatch_id: result.dispatch_id,
      locaweb_message_id: result.locaweb_message_id,
      status: result.status,
      scheduled_to: result.scheduled_to,
      warn: result.warn,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
