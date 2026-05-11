// src/lib/email-templates/dispatch-core.ts
//
// Função compartilhada que executa o disparo de um draft pra Locaweb.
// Usada tanto por:
//   - POST /api/crm/email-templates/drafts/[id]/dispatch  (envio direto)
//   - POST /api/crm/email-templates/drafts/[id]/approve    (envio após aprovação)

import type { SupabaseClient } from "@supabase/supabase-js";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { renderDraft } from "@/lib/email-templates/editor/render";
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import {
  applyUtmTracking,
  buildCampaignSlug,
  sanitizeEmailHtml,
} from "@/lib/email-templates/tracking";
import { randomUUID } from "crypto";
import type { Draft } from "@/lib/email-templates/editor/schema";
import type { TreeDraft, SectionNode } from "@/lib/email-templates/tree/schema";

export interface DispatchPayload {
  list_ids: string[];
  /** YYYY-MM-DD ou ISO completo BRT. */
  scheduled_to?: string;
  campaign_name?: string;
  sender_email?: string;
  sender_name?: string;
  suggestion_id?: string;
  utm_term?: string;
}

export type DispatchResult =
  | {
      ok: true;
      dispatch_id: string | null;
      locaweb_message_id: string;
      status: "queued" | "scheduled";
      scheduled_to: string | null;
      warn?: string;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      warn?: string;
      statusCode: number;
    };

export async function dispatchDraft(
  sb: SupabaseClient,
  workspaceId: string,
  draftId: string,
  payload: DispatchPayload
): Promise<DispatchResult> {
  const { data: draftRow, error: draftErr } = await sb
    .from("email_template_drafts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .maybeSingle();
  if (draftErr) {
    return { ok: false, error: draftErr.message, statusCode: 500 };
  }
  if (!draftRow) {
    return { ok: false, error: "Draft não encontrado.", statusCode: 404 };
  }

  type DraftRow = Draft & { meta: Draft["meta"] & { engine?: string } };
  const draft = draftRow as DraftRow;

  // Render to clean HTML (no editor click-handler script).
  let html: string;
  try {
    if (draft.meta?.engine === "tree") {
      const tree: TreeDraft = {
        id: draft.id,
        workspace_id: draft.workspace_id,
        layout_id: draft.layout_id,
        name: draft.name,
        meta: {
          subject: draft.meta.subject,
          preview: draft.meta.preview,
          mode: draft.meta.mode,
        },
        sections: draft.blocks as unknown as SectionNode[],
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      };
      html = await renderTreeDraft(tree);
    } else {
      html = renderDraft(draft);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Falha ao renderizar HTML: ${(err as Error).message}`,
      statusCode: 500,
    };
  }

  let creds;
  try {
    creds = await getReadyCreds(workspaceId);
  } catch (err) {
    return { ok: false, error: (err as Error).message, statusCode: 400 };
  }

  // Universal UTM tracking — every link to a Bulking host gets the same
  // utm_source/medium/campaign/id/term so click attribution lands in GA4
  // under one well-known set of dimensions.
  const dispatchId = randomUUID();
  const campaignSlug = buildCampaignSlug({
    kind: payload.suggestion_id ? "suggestion" : "draft",
    source_id: draft.id,
  });
  html = sanitizeEmailHtml(
    applyUtmTracking(html, {
      campaign: campaignSlug,
      term: payload.utm_term,
      id: dispatchId,
    })
  );

  const subject = draft.meta?.subject || draft.name || "Bulking";
  const campaignName =
    payload.campaign_name ?? `tpl_${draft.id.slice(0, 8)}_${draft.name.slice(0, 50)}`;

  // Locaweb leaves messages in "Rascunho" status when scheduled_to is
  // missing — they then need manual approval in the panel. We always
  // set scheduled_to (today BRT for "send now", future date for the
  // schedule toggle) so dispatched campaigns actually fire without
  // human intervention.
  const todayBrt = (() => {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() - 3);
    return d.toISOString().slice(0, 10);
  })();
  const effectiveScheduledTo = payload.scheduled_to ?? todayBrt;

  let messageRef;
  try {
    messageRef = await createMessage(creds.creds, {
      name: campaignName,
      subject,
      sender: payload.sender_email ?? creds.sender_email,
      sender_name: payload.sender_name ?? creds.sender_name,
      domain_id: creds.domain_id,
      html_body: html,
      list_ids: payload.list_ids,
      scheduled_to: effectiveScheduledTo,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error("[dispatch] Locaweb createMessage failed:", e);
    return {
      ok: false,
      error: `Locaweb rejeitou o envio: ${e.message ?? "erro desconhecido"}`,
      status: e.status,
      statusCode: 502,
    };
  }

  const messageId =
    messageRef.id ??
    (typeof messageRef._location === "string"
      ? messageRef._location.split("/").filter(Boolean).pop() ?? null
      : null);
  if (!messageId) {
    return {
      ok: false,
      error: "Locaweb não retornou um message_id.",
      statusCode: 502,
    };
  }

  const initialStatus: "queued" | "scheduled" = payload.scheduled_to
    ? "scheduled"
    : "queued";
  const { data: dispatchRow, error: insErr } = await sb
    .from("email_template_dispatches")
    .insert({
      id: dispatchId,
      workspace_id: workspaceId,
      draft_id: draft.id,
      suggestion_id: payload.suggestion_id ?? null,
      locaweb_message_id: messageId,
      locaweb_list_ids: payload.list_ids,
      scheduled_to: payload.scheduled_to
        ? new Date(
            /T/.test(payload.scheduled_to)
              ? payload.scheduled_to
              : `${payload.scheduled_to}T00:00:00-03:00`
          ).toISOString()
        : null,
      status: initialStatus,
      stats: {
        utm_campaign: campaignSlug,
        utm_id: dispatchId,
        utm_term: payload.utm_term ?? null,
      },
    })
    .select()
    .single();
  if (insErr) {
    console.error("[dispatch] dispatch row insert failed:", insErr);
    return {
      ok: true,
      dispatch_id: null,
      locaweb_message_id: messageId,
      status: initialStatus,
      scheduled_to: payload.scheduled_to ?? null,
      warn: `Email enviado pra Locaweb mas falhou ao registrar localmente: ${insErr.message}`,
    };
  }

  return {
    ok: true,
    dispatch_id: dispatchRow.id,
    locaweb_message_id: messageId,
    status: initialStatus,
    scheduled_to: payload.scheduled_to ?? null,
  };
}
