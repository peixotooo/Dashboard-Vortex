// src/lib/email-templates/dispatch-core.ts
//
// Função compartilhada que executa o disparo de um draft. Ramifica
// pelo provider configurado no workspace (locaweb ou iporto).
// Usada por:
//   - POST /api/crm/email-templates/drafts/[id]/dispatch  (envio direto)
//   - POST /api/crm/email-templates/drafts/[id]/approve    (envio após aprovação)

import type { SupabaseClient } from "@supabase/supabase-js";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import { createDelivery } from "@/lib/iporto/email-marketing";
import { getActiveProvider } from "@/lib/email-providers";
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

export interface DispatchRecipient {
  email: string;
  name?: string;
  /** Vars opcionais por destinatário pra interpolação no HTML. */
  vars?: Record<string, string | number | boolean>;
}

export interface DispatchPayload {
  /** Usado pelo provider Locaweb (fan-out lado-deles via list_ids). */
  list_ids?: string[];
  /** Usado pelo provider iPORTO (envio transacional 1-a-1). Se omitido
   *  e o provider for iPORTO, a dispatch falha com erro claro. */
  recipients?: DispatchRecipient[];
  /** YYYY-MM-DD ou ISO completo BRT. iPORTO ignora — envio imediato. */
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
      /** Locaweb: id único da mensagem. iPORTO: csv dos message_ids
       *  (um por destinatário) ou o primeiro. */
      locaweb_message_id: string;
      provider: "locaweb" | "iporto";
      status: "queued" | "scheduled";
      scheduled_to: string | null;
      /** iPORTO: contagem de envios bem-sucedidos/falhos. */
      recipients_total?: number;
      recipients_sent?: number;
      recipients_failed?: number;
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

  // Provider routing: workspace_email_marketing.provider decide qual
  // cliente usar. Default 'locaweb' (mantém compat com tudo que existia).
  const { provider } = await getActiveProvider(workspaceId);

  if (provider === "iporto") {
    return dispatchViaIporto({
      sb,
      workspaceId,
      draft,
      html,
      subject,
      payload,
      dispatchId,
      campaignSlug,
    });
  }

  return dispatchViaLocaweb({
    sb,
    workspaceId,
    draft,
    html,
    subject,
    campaignName,
    payload,
    dispatchId,
    campaignSlug,
  });
}

interface ProviderArgs {
  sb: SupabaseClient;
  workspaceId: string;
  draft: { id: string; name: string };
  html: string;
  subject: string;
  payload: DispatchPayload;
  dispatchId: string;
  campaignSlug: string;
}

async function dispatchViaLocaweb(
  args: ProviderArgs & { campaignName: string }
): Promise<DispatchResult> {
  const {
    sb,
    workspaceId,
    draft,
    html,
    subject,
    campaignName,
    payload,
    dispatchId,
    campaignSlug,
  } = args;

  if (!payload.list_ids || payload.list_ids.length === 0) {
    return {
      ok: false,
      error: "Locaweb exige list_ids no payload.",
      statusCode: 400,
    };
  }

  let creds;
  try {
    creds = await getReadyCreds(workspaceId);
  } catch (err) {
    return { ok: false, error: (err as Error).message, statusCode: 400 };
  }

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
      provider: "locaweb",
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
      provider: "locaweb",
      status: initialStatus,
      scheduled_to: payload.scheduled_to ?? null,
      warn: `Email enviado pra Locaweb mas falhou ao registrar localmente: ${insErr.message}`,
    };
  }

  return {
    ok: true,
    dispatch_id: dispatchRow.id,
    locaweb_message_id: messageId,
    provider: "locaweb",
    status: initialStatus,
    scheduled_to: payload.scheduled_to ?? null,
  };
}

async function dispatchViaIporto(args: ProviderArgs): Promise<DispatchResult> {
  const {
    sb,
    workspaceId,
    draft,
    html,
    subject,
    payload,
    dispatchId,
    campaignSlug,
  } = args;

  if (!payload.recipients || payload.recipients.length === 0) {
    return {
      ok: false,
      error:
        "iPORTO precisa de uma lista de destinatários no payload (recipients[]).",
      statusCode: 400,
    };
  }

  // Limite defensivo: iPORTO é 1-request por destinatário e a Vercel
  // tem timeout. Acima desse limite, o caller deve quebrar em lotes.
  const HARD_CAP = 500;
  if (payload.recipients.length > HARD_CAP) {
    return {
      ok: false,
      error: `Lista de destinatários (${payload.recipients.length}) excede o limite atual do dispatch iPORTO síncrono (${HARD_CAP}). Quebre em lotes ou use Locaweb.`,
      statusCode: 400,
    };
  }

  let creds;
  try {
    creds = await getIportoReadyCreds(workspaceId);
  } catch (err) {
    return { ok: false, error: (err as Error).message, statusCode: 400 };
  }

  const senderEmail = payload.sender_email ?? creds.sender_email;
  const senderName = payload.sender_name ?? creds.sender_name;

  // Envia em paralelo limitado pra não derrubar a iPORTO. ~10 requests
  // simultâneas é um sweet spot conservador.
  const CONCURRENCY = 10;
  const messageIds: string[] = [];
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  const renderForRecipient = (r: DispatchRecipient): string => {
    if (!r.vars) return html;
    let out = html;
    for (const [k, v] of Object.entries(r.vars)) {
      out = out.replaceAll(`{{${k}}}`, String(v));
    }
    return out;
  };

  for (let i = 0; i < payload.recipients.length; i += CONCURRENCY) {
    const batch = payload.recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((r) =>
        createDelivery(creds.creds, {
          subject,
          from: senderEmail,
          from_name: senderName,
          address_to: r.email,
          html_body: renderForRecipient(r),
          headers: {
            envio_id: dispatchId,
            campaign: campaignSlug,
          },
          tags: [`dispatch:${dispatchId}`, `campaign:${campaignSlug}`],
          tracking_settings: { track_open: "yes", track_link: "yes" },
        })
      )
    );
    for (const res of results) {
      if (res.status === "fulfilled") {
        const mid = res.value.message_id ?? res.value.request_id;
        if (mid) messageIds.push(mid);
        sent++;
      } else {
        failed++;
        if (errors.length < 5) {
          const e = res.reason as { message?: string };
          errors.push(e?.message ?? "erro desconhecido");
        }
      }
    }
  }

  const initialStatus: "queued" | "scheduled" = "queued";
  const { data: dispatchRow, error: insErr } = await sb
    .from("email_template_dispatches")
    .insert({
      id: dispatchId,
      workspace_id: workspaceId,
      draft_id: draft.id,
      suggestion_id: payload.suggestion_id ?? null,
      provider: "iporto",
      locaweb_message_id: null,
      locaweb_list_ids: [],
      iporto_message_ids: messageIds,
      recipients_total: payload.recipients.length,
      recipients_sent: sent,
      recipients_failed: failed,
      scheduled_to: null,
      status: failed === payload.recipients.length ? "failed" : initialStatus,
      stats: {
        utm_campaign: campaignSlug,
        utm_id: dispatchId,
        utm_term: payload.utm_term ?? null,
        errors_sample: errors,
      },
    })
    .select()
    .single();

  if (insErr) {
    console.error("[dispatch] dispatch row insert failed:", insErr);
    return {
      ok: true,
      dispatch_id: null,
      locaweb_message_id: messageIds[0] ?? "",
      provider: "iporto",
      status: initialStatus,
      scheduled_to: null,
      recipients_total: payload.recipients.length,
      recipients_sent: sent,
      recipients_failed: failed,
      warn: `Envios iPORTO completos (${sent}/${payload.recipients.length}) mas falhou ao registrar localmente: ${insErr.message}`,
    };
  }

  if (failed === payload.recipients.length) {
    return {
      ok: false,
      error: `Todos os ${payload.recipients.length} envios iPORTO falharam. Primeiro erro: ${errors[0] ?? "desconhecido"}`,
      statusCode: 502,
    };
  }

  return {
    ok: true,
    dispatch_id: dispatchRow.id,
    locaweb_message_id: messageIds[0] ?? "",
    provider: "iporto",
    status: initialStatus,
    scheduled_to: null,
    recipients_total: payload.recipients.length,
    recipients_sent: sent,
    recipients_failed: failed,
    warn:
      failed > 0
        ? `${failed} de ${payload.recipients.length} destinatários falharam.`
        : undefined,
  };
}
