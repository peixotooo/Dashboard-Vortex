// src/app/api/crm/email-templates/[id]/dispatch/route.ts
//
// Dispatches a daily-suggestion email. Ramifica pelo provider ativo do
// workspace:
//   - Locaweb: usa createMessage com list_ids (fan-out da Locaweb)
//   - iPORTO: resolve recipients via RFM cluster (use_segment) ou body
//     e enfileira em email_template_iporto_envios; cron-dispatcher entrega

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { getAudienceByLocawebListId } from "@/lib/email-templates/audiences";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import {
  getActiveProvider,
  getWorkspaceHomeUrl,
} from "@/lib/email-providers";
import {
  applyUtmTracking,
  buildCampaignSlug,
  sanitizeEmailHtml,
  wrapUnlinkedImages,
} from "@/lib/email-templates/tracking";
import {
  materializeSegmentList,
  resolveSegmentRecipients,
} from "@/lib/email-templates/segment-list";
import type { Slot, ProductSnapshot } from "@/lib/email-templates/types";
import { ensureCouponRegistered } from "@/lib/email-templates/coupon";
import { randomUUID } from "crypto";

type ProductSnapshotMin = Partial<ProductSnapshot> & { name?: string };

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  list_ids?: Array<string | number>;
  /** When true, materialize the suggestion's RFM cluster — Locaweb path
   *  creates a list; iPORTO path resolves recipients[] direto. */
  use_segment?: boolean;
  /** Recipients explícitos pra iPORTO (alternativa ao use_segment). */
  recipients?: Array<{ email: string; name?: string | null }>;
  scheduled_to?: string;
  utm_term?: string;
  /** Subject editado no wizard. Aplica direto no envio (Locaweb/iPORTO)
   *  sem precisar promover a sugestão a rascunho. Headline/lead/CTA
   *  continuam exigindo o caminho "Salvar como rascunho" porque viraram
   *  rendered_html no momento da geração. */
  subject_override?: string;
  retention_context?: {
    list_id?: string;
    audience?: string;
    playbook?: string;
    run?: string;
  };
}

function retentionStats(context: Body["retention_context"]): Record<string, unknown> {
  if (!context) return {};
  return {
    playbook_run_id: context.run || null,
    playbook_name: context.playbook || null,
    playbook_audience: context.audience || null,
    playbook_locaweb_list_id: context.list_id || null,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as Body;

    const manualListIds = Array.isArray(body.list_ids) ? body.list_ids : [];
    const sb = createAdminClient();
    const { provider } = await getActiveProvider(workspaceId);

    // Validação de audiência (independe do provider, agora). list_ids vêm
    // do CRM (criadas via "Lista de email") e funcionam pra ambos providers:
    // Locaweb usa direto, iPORTO resolve em recipients[] via getListContacts.
    if (
      manualListIds.length === 0 &&
      !body.use_segment &&
      (!body.recipients || body.recipients.length === 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Escolha ao menos uma lista, ative o segmento sugerido (RFM) ou passe recipients[] no payload.",
        },
        { status: 400 }
      );
    }
    const { data: sug, error: sugErr } = await sb
      .from("email_template_suggestions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (sugErr) return NextResponse.json({ error: sugErr.message }, { status: 500 });
    if (!sug) return NextResponse.json({ error: "suggestion not found" }, { status: 404 });

    type SugRow = {
      id: string;
      slot: number;
      generated_for_date: string;
      rendered_html: string;
      copy?: { subject?: string };
      product_snapshot?: ProductSnapshotMin;
      target_segment_payload?: { display_label?: string };
      coupon_code: string | null;
      coupon_vnda_promotion_id: number | null;
      coupon_vnda_coupon_id: number | null;
      coupon_expires_at: string | null;
      coupon_discount_percent: number | null;
    };
    const s = sug as unknown as SugRow;

    if (!s.rendered_html) {
      return NextResponse.json(
        { error: "Sugestão sem rendered_html." },
        { status: 400 }
      );
    }

    // Cupom slot 2: o cron de geração só preparou code+expires_at local. A
    // promoção só vai pra VNDA agora, no momento do disparo. Sugestões
    // geradas mas não enviadas não enchem a VNDA de promos órfãs.
    const couponRegistration = await ensureCouponRegistered(sb, workspaceId, s);
    if (!couponRegistration.ok) {
      return NextResponse.json(
        { error: couponRegistration.error },
        { status: couponRegistration.statusCode }
      );
    }

    // ── iPORTO branch ─────────────────────────────────────────────────
    if (provider === "iporto") {
      return await dispatchSuggestionViaIporto({
        sb,
        workspaceId,
        suggestion: s,
        body,
      });
    }

    // ── Locaweb branch (fluxo original) ───────────────────────────────
    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // Universal UTM tracking — same contract as draft dispatch + active feed.
    const dispatchId = randomUUID();

    // If the user opted in to dispatching to the suggested RFM cluster,
    // materialize it as a Locaweb list right now and merge the resulting
    // id into list_ids. This is the cluster→lista sync that used to be
    // marked "v2" in the dialog.
    let materialized: { list_id: string | number; list_name: string; count: number } | null = null;
    if (body.use_segment) {
      try {
        materialized = await materializeSegmentList({
          workspace_id: workspaceId,
          slot: s.slot as Slot,
          creds: creds.creds,
        });
      } catch (err) {
        return NextResponse.json(
          { error: `Falha ao materializar segmento: ${(err as Error).message}` },
          { status: 502 }
        );
      }
    }
    const finalListIds: Array<string | number> = [
      ...manualListIds,
      ...(materialized ? [materialized.list_id] : []),
    ];
    const campaignSlug = buildCampaignSlug({
      kind: "suggestion",
      date: s.generated_for_date,
      slot: s.slot,
      source_id: s.id,
    });
    const html = sanitizeEmailHtml(
      applyUtmTracking(s.rendered_html, {
        campaign: campaignSlug,
        term: body.utm_term,
        id: dispatchId,
      })
    );

    // scheduled_to default = today BRT (Locaweb keeps messages as Rascunho
    // when schedule is missing).
    const todayBrt = (() => {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() - 3);
      return d.toISOString().slice(0, 10);
    })();
    const effectiveScheduledTo = body.scheduled_to ?? todayBrt;

    const subject =
      (typeof body.subject_override === "string" && body.subject_override.trim()) ||
      s.copy?.subject ||
      `${s.product_snapshot?.name ?? "Bulking"} · slot ${s.slot}`;
    const campaignName = `sug_${s.slot}_${s.generated_for_date}_${s.id.slice(0, 8)}`;

    let messageRef;
    try {
      messageRef = await createMessage(creds.creds, {
        name: campaignName,
        subject,
        sender: creds.sender_email,
        sender_name: creds.sender_name,
        domain_id: creds.domain_id,
        html_body: html,
        list_ids: finalListIds,
        scheduled_to: effectiveScheduledTo,
      });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      console.error("[suggestion-dispatch] Locaweb createMessage failed:", e);
      return NextResponse.json(
        { error: `Locaweb rejeitou o envio: ${e.message ?? "erro desconhecido"}` },
        { status: 502 }
      );
    }

    const messageId =
      messageRef.id ??
      (typeof messageRef._location === "string"
        ? messageRef._location.split("/").filter(Boolean).pop() ?? null
        : null);
    if (!messageId) {
      return NextResponse.json(
        { error: "Locaweb não retornou um message_id." },
        { status: 502 }
      );
    }

    const initialStatus = body.scheduled_to ? "scheduled" : "queued";
    const { data: dispatchRow, error: insErr } = await sb
      .from("email_template_dispatches")
      .insert({
        id: dispatchId,
        workspace_id: workspaceId,
        suggestion_id: s.id,
        locaweb_message_id: messageId,
        locaweb_list_ids: finalListIds.map(String),
        scheduled_to: body.scheduled_to
          ? new Date(
              // Bare YYYY-MM-DD → midnight BRT; full ISO datetime → as-is.
              /T/.test(body.scheduled_to)
                ? body.scheduled_to
                : `${body.scheduled_to}T00:00:00-03:00`
            ).toISOString()
          : null,
        status: initialStatus,
        stats: {
          utm_campaign: campaignSlug,
          utm_id: dispatchId,
          utm_term: body.utm_term ?? null,
          target_segment: s.target_segment_payload?.display_label ?? null,
          ...retentionStats(body.retention_context),
          materialized_segment_list: materialized
            ? {
                list_id: String(materialized.list_id),
                list_name: materialized.list_name,
                count: materialized.count,
              }
            : null,
        },
      })
      .select()
      .single();
    if (insErr) {
      console.error("[suggestion-dispatch] insert failed:", insErr);
      return NextResponse.json({
        ok: true,
        locaweb_message_id: messageId,
        warn: `Locaweb aceitou mas falhou ao registrar: ${insErr.message}`,
      });
    }

    // Mark suggestion as 'sent' so the dashboard reflects the disparada state.
    await sb
      .from("email_template_suggestions")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", s.id);

    return NextResponse.json({
      ok: true,
      dispatch_id: dispatchRow.id,
      locaweb_message_id: messageId,
      status: initialStatus,
      scheduled_to: body.scheduled_to ?? null,
      materialized_segment: materialized
        ? {
            list_id: String(materialized.list_id),
            list_name: materialized.list_name,
            count: materialized.count,
          }
        : null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

// ────────────────────────────────────────────────────────────────────────
// iPORTO branch: cria dispatch row + enfileira envios pra cron-dispatcher
// processar. iPORTO é 1-request por destinatário, então usamos a mesma
// fila do dispatch-core.dispatchViaIporto (drafts/dispatch).
// ────────────────────────────────────────────────────────────────────────

interface IportoSugContext {
  sb: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  suggestion: {
    id: string;
    slot: number;
    generated_for_date: string;
    rendered_html: string;
    copy?: { subject?: string };
    product_snapshot?: ProductSnapshotMin;
    target_segment_payload?: { display_label?: string };
    coupon_code: string | null;
    coupon_vnda_promotion_id: number | null;
    coupon_vnda_coupon_id: number | null;
    coupon_expires_at: string | null;
    coupon_discount_percent: number | null;
  };
  body: Body;
}

async function dispatchSuggestionViaIporto(
  ctx: IportoSugContext
): Promise<NextResponse> {
  const { sb, workspaceId, suggestion: s, body } = ctx;

  // 1. Credenciais iPORTO
  let creds;
  try {
    creds = await getIportoReadyCreds(workspaceId);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // 2. Resolver lista de destinatários. 3 fontes possíveis, na ordem:
  //   a) body.recipients[] explícito (override mais direto)
  //   b) body.list_ids — fetch dos contatos das listas Locaweb (servem de
  //      "saved audience" provider-agnostic; CRM grava elas via "Lista
  //      de email"). Une e dedupe por email.
  //   c) body.use_segment — cluster RFM do slot
  const recipientsMap = new Map<string, { email: string; name?: string | null }>();
  let clusterLabel: string | undefined;
  const listIds = Array.isArray(body.list_ids) ? body.list_ids : [];

  if (body.recipients && body.recipients.length > 0) {
    for (const r of body.recipients) {
      const email =
        typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (!email) continue;
      if (!recipientsMap.has(email)) {
        recipientsMap.set(email, { email, name: r.name ?? null });
      }
    }
  }

  if (listIds.length > 0) {
    // Lê audiência do storage local (Locaweb não expõe GET de contatos).
    // Listas criadas antes da migration-078 não vão ter cópia local —
    // erro claro nesse caso.
    for (const lid of listIds) {
      try {
        const contacts = await getAudienceByLocawebListId(sb, workspaceId, String(lid));
        if (contacts.length === 0) {
          return NextResponse.json(
            {
              error: `Lista ${lid} não tem cópia local da audiência. Recrie a lista no CRM pra registrar os contatos no Vortex.`,
            },
            { status: 400 }
          );
        }
        for (const c of contacts) {
          if (!recipientsMap.has(c.email)) {
            recipientsMap.set(c.email, c);
          }
        }
      } catch (err) {
        return NextResponse.json(
          {
            error: `Falha ao buscar contatos da lista ${lid}: ${(err as Error).message}`,
          },
          { status: 500 }
        );
      }
    }
  }

  if (body.use_segment) {
    try {
      const seg = await resolveSegmentRecipients({
        workspace_id: workspaceId,
        slot: s.slot as Slot,
      });
      clusterLabel = seg.cluster_label;
      for (const r of seg.recipients) {
        if (!recipientsMap.has(r.email)) {
          recipientsMap.set(r.email, r);
        }
      }
    } catch (err) {
      // Só falha se for a única fonte; se já temos lists/recipients, segue.
      if (recipientsMap.size === 0) {
        return NextResponse.json(
          { error: (err as Error).message },
          { status: 502 }
        );
      }
    }
  }

  const recipients = [...recipientsMap.values()];
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "Nenhum destinatário resolvido das fontes informadas." },
      { status: 400 }
    );
  }

  // 3. Renderiza HTML com UTMs + wrap de imagens
  const dispatchId = randomUUID();
  const campaignSlug = buildCampaignSlug({
    kind: "suggestion",
    date: s.generated_for_date,
    slot: s.slot,
    source_id: s.id,
  });
  const homeUrl = await getWorkspaceHomeUrl(workspaceId);
  const html = sanitizeEmailHtml(
    applyUtmTracking(wrapUnlinkedImages(s.rendered_html, homeUrl), {
      campaign: campaignSlug,
      term: body.utm_term ?? clusterLabel,
      id: dispatchId,
    })
  );

  const subject =
    (typeof body.subject_override === "string" && body.subject_override.trim()) ||
    s.copy?.subject ||
    `${s.product_snapshot?.name ?? "Bulking"} · slot ${s.slot}`;

  // 4. Cria o dispatch row com html_body etc — cron-dispatcher lê de lá
  const { data: dispatchRow, error: insErr } = await sb
    .from("email_template_dispatches")
    .insert({
      id: dispatchId,
      workspace_id: workspaceId,
      suggestion_id: s.id,
      provider: "iporto",
      locaweb_message_id: null,
      locaweb_list_ids: listIds.map(String),
      iporto_message_ids: [],
      recipients_total: recipients.length,
      recipients_sent: 0,
      recipients_failed: 0,
      scheduled_to: body.scheduled_to
        ? new Date(
            /T/.test(body.scheduled_to)
              ? body.scheduled_to
              : `${body.scheduled_to}T00:00:00-03:00`
          ).toISOString()
        : null,
      status: "queued",
      html_body: html,
      subject,
      from_email: creds.sender_email,
      from_name: creds.sender_name,
      stats: {
        utm_campaign: campaignSlug,
        utm_id: dispatchId,
        utm_term: body.utm_term ?? clusterLabel ?? null,
        target_segment: s.target_segment_payload?.display_label ?? clusterLabel ?? null,
        ...retentionStats(body.retention_context),
      },
    })
    .select()
    .single();

  if (insErr) {
    return NextResponse.json(
      { error: `Falha ao criar dispatch: ${insErr.message}` },
      { status: 500 }
    );
  }

  // 5. Enfileira envios em chunks (Supabase tem cap de payload)
  const CHUNK = 1000;
  const envios = recipients.map((r) => ({
    dispatch_id: dispatchId,
    workspace_id: workspaceId,
    email: r.email,
    name: r.name ?? null,
    vars: {},
  }));
  for (let i = 0; i < envios.length; i += CHUNK) {
    const slice = envios.slice(i, i + CHUNK);
    const { error } = await sb
      .from("email_template_iporto_envios")
      .insert(slice);
    if (error) {
      await sb
        .from("email_template_dispatches")
        .update({ status: "failed" })
        .eq("id", dispatchId);
      return NextResponse.json(
        {
          error: `Falha ao enfileirar envios (chunk ${i}): ${error.message}`,
        },
        { status: 500 }
      );
    }
  }

  // 6. Marca sugestão como sent (UX — sai da fila de "Hoje")
  await sb
    .from("email_template_suggestions")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", s.id);

  return NextResponse.json({
    ok: true,
    dispatch_id: dispatchRow.id,
    provider: "iporto",
    status: "queued",
    recipients_total: recipients.length,
    cluster_label: clusterLabel ?? null,
    note: `${recipients.length} envios enfileirados. Cron iporto-dispatcher processa ~1000/min.`,
  });
}
