// src/lib/email-templates/dispatch-core.ts
//
// Função compartilhada que enfileira o disparo de um draft. Disparo em massa
// deve passar pelo provider iPORTO, processado pelo worker do Droplet.
// Usada por:
//   - POST /api/crm/email-templates/drafts/[id]/dispatch  (envio direto)
//   - POST /api/crm/email-templates/drafts/[id]/approve    (envio após aprovação)

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAudienceByLocawebListId } from "@/lib/email-templates/audiences";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import { getActiveProvider, getWorkspaceHomeUrl } from "@/lib/email-providers";
import { massActionWorkerOnlyPayload } from "@/lib/mass-actions/policy";
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
  /** IDs de listas salvas no CRM; o iPORTO resolve os contatos via cópia local. */
  list_ids?: string[];
  /** Destinatários explícitos para envio transacional 1-a-1 no iPORTO. */
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
    playbook_id?: string;
    run?: string;
  };
}

export type DispatchResult =
  | {
      ok: true;
      dispatch_id: string | null;
      /** Mantido por compatibilidade do contrato; iPORTO retorna string vazia ao enfileirar. */
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

  // Provider routing: disparo em massa de CRM só pode enfileirar no iPORTO,
  // que é processado pelo worker dedicado no Droplet.
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

  const workerOnly = massActionWorkerOnlyPayload("Disparo de CRM por e-mail");
  return {
    ok: false,
    error: workerOnly.message,
    statusCode: 409,
    warn: workerOnly.error,
  };
}

function retentionStats(
  draft: { meta?: Draft["meta"] },
  payload: DispatchPayload
): Record<string, unknown> {
  const context = payload.retention_context ?? draft.meta?.retention_context;
  if (!context) return {};
  return {
    playbook_run_id: context.run || null,
    playbook_id: context.playbook_id || null,
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
