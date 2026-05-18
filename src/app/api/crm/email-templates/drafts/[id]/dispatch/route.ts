// src/app/api/crm/email-templates/drafts/[id]/dispatch/route.ts
//
// Sends a draft as a Locaweb campaign. Re-renders the draft to clean HTML
// (no editor instrumentation), creates the message via Locaweb's API, and
// records the resulting message_id in email_template_dispatches so the
// stats-sync cron can roll up open/click/bounce data later.
//
// "Rascunho agendado com aprovação": quando o body traz
// `requires_approval=true`, NÃO chamamos a Locaweb — apenas salvamos o
// dispatch_payload e o scheduled_for no próprio draft com
// approval_state='pending_approval'. O envio real só acontece quando
// alguém clicar em "Aprovar" em /drafts (via .../approve). O aprovador
// pode ser o mesmo usuário que submeteu — não exige second-pair.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { dispatchDraft, type DispatchPayload } from "@/lib/email-templates/dispatch-core";
import {
  ensureCouponRegistered,
  type SuggestionCouponState,
} from "@/lib/email-templates/coupon";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body extends Partial<DispatchPayload> {
  list_ids: string[];
  /** Optional ISO date YYYY-MM-DD or full ISO datetime (BRT). */
  scheduled_to?: string;
  /** Se true, salva como rascunho pendente de aprovação em vez de enviar. */
  requires_approval?: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as Body;

    if (!Array.isArray(body.list_ids) || body.list_ids.length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos uma lista da Locaweb." },
        { status: 400 }
      );
    }

    const sb = createAdminClient();

    // --- Rascunho agendado com aprovação ---
    if (body.requires_approval) {
      if (!body.scheduled_to) {
        return NextResponse.json(
          {
            error:
              "Pra enviar como rascunho com aprovação, preencha data e hora de envio.",
          },
          { status: 400 }
        );
      }
      const payload: DispatchPayload = {
        list_ids: body.list_ids,
        scheduled_to: body.scheduled_to,
        campaign_name: body.campaign_name,
        sender_email: body.sender_email,
        sender_name: body.sender_name,
        suggestion_id: body.suggestion_id,
        utm_term: body.utm_term,
      };
      const { error: upErr } = await sb
        .from("email_template_drafts")
        .update({
          approval_state: "pending_approval",
          scheduled_for: body.scheduled_to
            ? new Date(
                /T/.test(body.scheduled_to)
                  ? body.scheduled_to
                  : `${body.scheduled_to}T00:00:00-03:00`
              ).toISOString()
            : null,
          dispatch_payload: payload,
          submitted_by: userId,
          submitted_at: new Date().toISOString(),
          // Limpa estado anterior de rejeição/aprovação se reenviar.
          approved_by: null,
          approved_at: null,
          rejected_by: null,
          rejected_at: null,
          rejection_reason: null,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        status: "pending_approval",
        scheduled_to: body.scheduled_to ?? null,
      });
    }

    // --- Envio direto (fluxo legado) ---

    // Cupom slot 2: se este draft veio de uma sugestão com cupom preparado
    // mas não registrado na VNDA, registra agora. Mesma lógica do envio
    // direto da sugestão — VNDA só vê o cupom no momento que o usuário
    // realmente decide disparar.
    if (body.suggestion_id) {
      const { data: sug } = await sb
        .from("email_template_suggestions")
        .select(
          "id, product_snapshot, coupon_code, coupon_vnda_promotion_id, coupon_vnda_coupon_id, coupon_expires_at, coupon_discount_percent"
        )
        .eq("workspace_id", workspaceId)
        .eq("id", body.suggestion_id)
        .maybeSingle();
      if (sug) {
        const reg = await ensureCouponRegistered(
          sb,
          workspaceId,
          sug as unknown as SuggestionCouponState
        );
        if (!reg.ok) {
          return NextResponse.json({ error: reg.error }, { status: reg.statusCode });
        }
      }
    }

    const result = await dispatchDraft(sb, workspaceId, id, {
      list_ids: body.list_ids,
      scheduled_to: body.scheduled_to,
      campaign_name: body.campaign_name,
      sender_email: body.sender_email,
      sender_name: body.sender_name,
      suggestion_id: body.suggestion_id,
      utm_term: body.utm_term,
    });
    if (!result.ok) {
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
