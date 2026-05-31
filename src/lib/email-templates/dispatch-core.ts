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
import { getAudienceByLocawebListId } from "@/lib/email-templates/audiences";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import { getActiveProvider, getWorkspaceHomeUrl } from "@/lib/email-providers";
import { renderDraft } from "@/lib/email-templates/editor/render";
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import {
  applyUtmTracking,
  buildCampaignSlug,
  sanitizeEmailHtml,
  wrapUnlinkedImages,
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
  retention_context?: {
    list_id?: string;
    audience?: string;
    playbook?: string;
    run?: string;
  };
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
  // Pipeline: wrapUnlinkedImages → applyUtmTracking → sanitize.
  // Wrap antes pra que os <a> novos (logo + imagens decorativas) já
  // sejam taggeados com UTMs pelo applyUtmTracking. home_url vem das
  // settings do workspace ou é derivado do domínio do sender.
  const homeUrl = await getWorkspaceHomeUrl(workspaceId);
  html = sanitizeEmailHtml(
    applyUtmTracking(wrapUnlinkedImages(html, homeUrl), {
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

function retentionStats(
  draft: { meta?: Draft["meta"] },
  payload: DispatchPayload
): Record<string, unknown> {
  const context = payload.retention_context ?? draft.meta?.retention_context;
  if (!context) return {};
  return {
    playbook_run_id: context.run || null,
    playbook_name: context.playbook || null,
    playbook_audience: context.audience || null,
    playbook_locaweb_list_id: context.list_id || null,
  };
}

interface ProviderArgs {
  sb: SupabaseClient;
  workspaceId: string;
  draft: { id: string; name: string; meta?: Draft["meta"] };
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
        ...retentionStats(draft, payload),
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

  // Resolve a audiência iPORTO a partir de 2 fontes (unidas + dedup):
  //  - payload.recipients[] explícito (override direto)
  //  - payload.list_ids — Locaweb funciona como "audience storage" mesmo
  //    quando o envio sai via iPORTO; fetch dos contatos da lista lá
  // Caso o caller não tenha passado nem um nem outro, falha cedo.
  const recipientsMap = new Map<string, DispatchRecipient>();
  if (payload.recipients && payload.recipients.length > 0) {
    for (const r of payload.recipients) {
      const email =
        typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (!email) continue;
      if (!recipientsMap.has(email)) {
        recipientsMap.set(email, { ...r, email });
      }
    }
  }
  if (payload.list_ids && payload.list_ids.length > 0) {
    // Lê a audiência do nosso storage local (email_template_audiences).
    // Locaweb não expõe GET de contatos da lista — então persistimos
    // uma cópia local no momento do bulk-import. Listas criadas ANTES
    // dessa migração não terão registro aqui; nesse caso a iPORTO falha
    // claramente pedindo recriação da lista.
    for (const lid of payload.list_ids) {
      try {
        const contacts = await getAudienceByLocawebListId(
          sb,
          workspaceId,
          String(lid)
        );
        if (contacts.length === 0) {
          return {
            ok: false,
            error: `Lista ${lid} não tem cópia local da audiência. Recrie a lista no CRM pra registrar os contatos no Vortex (Locaweb não permite ler contatos de volta).`,
            statusCode: 400,
          };
        }
        for (const c of contacts) {
          if (!recipientsMap.has(c.email)) {
            recipientsMap.set(c.email, {
              email: c.email,
              name: c.name ?? undefined,
            });
          }
        }
      } catch (err) {
        return {
          ok: false,
          error: `Falha ao buscar contatos da lista ${lid}: ${(err as Error).message}`,
          statusCode: 500,
        };
      }
    }
  }
  const recipients = [...recipientsMap.values()];
  if (recipients.length === 0) {
    return {
      ok: false,
      error:
        "iPORTO precisa de audiência — passe list_ids (vindos do CRM) ou recipients[] no payload.",
      statusCode: 400,
    };
  }

  // Sanity-check das credenciais antes de enfileirar — falhar cedo se
  // o workspace não configurou nada.
  let creds;
  try {
    creds = await getIportoReadyCreds(workspaceId);
  } catch (err) {
    return { ok: false, error: (err as Error).message, statusCode: 400 };
  }
  const senderEmail = payload.sender_email ?? creds.sender_email;
  const senderName = payload.sender_name ?? creds.sender_name;

  // Cria o dispatch row em status='queued' carregando o template HTML/
  // assunto/remetente — o cron usa isso pra renderizar por destinatário.
  const { data: dispatchRow, error: insErr } = await sb
    .from("email_template_dispatches")
    .insert({
      id: dispatchId,
      workspace_id: workspaceId,
      draft_id: draft.id,
      suggestion_id: payload.suggestion_id ?? null,
      provider: "iporto",
      locaweb_message_id: null,
      locaweb_list_ids: payload.list_ids ?? [],
      iporto_message_ids: [],
      recipients_total: recipients.length,
      recipients_sent: 0,
      recipients_failed: 0,
      scheduled_to: null,
      status: "queued",
      html_body: html,
      subject,
      from_email: senderEmail,
      from_name: senderName,
      stats: {
        utm_campaign: campaignSlug,
        utm_id: dispatchId,
        utm_term: payload.utm_term ?? null,
        ...retentionStats(draft, payload),
      },
    })
    .select()
    .single();

  if (insErr) {
    return {
      ok: false,
      error: `Falha ao criar dispatch: ${insErr.message}`,
      statusCode: 500,
    };
  }

  // Insere envios em chunks de 1000 (cap do payload do Supabase).
  const CHUNK = 1000;
  const envios = recipients.map((r) => ({
    dispatch_id: dispatchId,
    workspace_id: workspaceId,
    email: r.email,
    name: r.name ?? null,
    vars: r.vars ?? {},
  }));
  for (let i = 0; i < envios.length; i += CHUNK) {
    const slice = envios.slice(i, i + CHUNK);
    const { error } = await sb
      .from("email_template_iporto_envios")
      .insert(slice);
    if (error) {
      // Marca o dispatch como failed pra não ficar "queued" pra sempre.
      await sb
        .from("email_template_dispatches")
        .update({ status: "failed" })
        .eq("id", dispatchId);
      return {
        ok: false,
        error: `Falha ao enfileirar envios (chunk ${i}-${i + slice.length}): ${error.message}`,
        statusCode: 500,
      };
    }
  }

  return {
    ok: true,
    dispatch_id: dispatchRow.id,
    locaweb_message_id: "",
    provider: "iporto",
    status: "queued",
    scheduled_to: null,
    recipients_total: recipients.length,
    recipients_sent: 0,
    recipients_failed: 0,
    warn: `${recipients.length} envios enfileirados. Cron iporto-dispatcher processa ~1000/min.`,
  };
}
