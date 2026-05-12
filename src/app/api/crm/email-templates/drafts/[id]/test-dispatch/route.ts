// src/app/api/crm/email-templates/drafts/[id]/test-dispatch/route.ts
//
// Sends a *preview* of a draft to a small set of email addresses (by
// default the logged-in user's). Mirrors the suggestion test-dispatch:
// renders the draft to clean HTML, creates a throwaway Locaweb list,
// pushes the test contacts, and dispatches without persisting anything
// to email_template_dispatches — so test sends never pollute reports.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import { createDelivery, extractMessageId } from "@/lib/iporto/email-marketing";
import { getActiveProvider, getWorkspaceHomeUrl } from "@/lib/email-providers";
import { ensureTestList } from "@/lib/email-templates/test-list";
import { renderDraft } from "@/lib/email-templates/editor/render";
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml, wrapUnlinkedImages } from "@/lib/email-templates/tracking";
import { randomUUID } from "crypto";
import type { Draft } from "@/lib/email-templates/editor/schema";
import type { TreeDraft, SectionNode } from "@/lib/email-templates/tree/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  test_emails: string[];
}

function isValidEmail(e: string | undefined | null): e is string {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as Body;

    const emails = Array.isArray(body.test_emails)
      ? Array.from(
          new Set(
            body.test_emails
              .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
              .filter(isValidEmail)
          )
        )
      : [];
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos um email válido para o teste." },
        { status: 400 }
      );
    }
    if (emails.length > 10) {
      return NextResponse.json(
        { error: "Máximo de 10 emails por teste." },
        { status: 400 }
      );
    }

    const sb = createAdminClient();
    const { data: draftRow, error: draftErr } = await sb
      .from("email_template_drafts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (draftErr) {
      return NextResponse.json({ error: draftErr.message }, { status: 500 });
    }
    if (!draftRow) {
      return NextResponse.json({ error: "Draft não encontrado." }, { status: 404 });
    }

    type DraftRow = Draft & { meta: Draft["meta"] & { engine?: string } };
    const draft = draftRow as DraftRow;

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
      return NextResponse.json(
        { error: `Falha ao renderizar HTML: ${(err as Error).message}` },
        { status: 500 }
      );
    }

    const dispatchId = randomUUID();
    const campaignSlug =
      buildCampaignSlug({ kind: "draft", source_id: draft.id }) + "-test";
    const homeUrl = await getWorkspaceHomeUrl(workspaceId);
    html = sanitizeEmailHtml(
      applyUtmTracking(wrapUnlinkedImages(html, homeUrl), {
        campaign: campaignSlug,
        id: dispatchId,
      })
    );
    const subject = `[TESTE] ${draft.meta?.subject || draft.name || "Bulking"}`;

    // Ramifica pelo provider — o test send precisa usar o mesmo provider
    // ativo do workspace, senão o usuário testa Locaweb e dispara iPORTO
    // (ou vice-versa) e nunca compara o que vai chegar de verdade.
    const { provider } = await getActiveProvider(workspaceId);

    if (provider === "iporto") {
      let iCreds;
      try {
        iCreds = await getIportoReadyCreds(workspaceId);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
      const messageIds: string[] = [];
      const responses: Array<{ email: string; body: unknown }> = [];
      const errors: string[] = [];
      const results = await Promise.allSettled(
        emails.map((email) =>
          createDelivery(iCreds.creds, {
            subject,
            from: iCreds.sender_email,
            from_name: iCreds.sender_name,
            address_to: email,
            html_body: html,
            headers: { envio_id: dispatchId, test: "true" },
            tags: [`test:${dispatchId}`],
            // track_link OFF: iPORTO embrulha cada link com track-s1.*
            // E injeta utm_source=iPORTO/utm_medium=smtp por cima das
            // nossas UTMs (applyUtmTracking). Resultado: dois utm_source
            // na URL final → o próprio track server rejeita com
            // "Parâmetros inválidos". Mantemos as UTMs do Vortex que
            // já apontam pro GA4 corretamente.
            tracking_settings: { track_open: "yes", track_link: "no" },
          })
        )
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const email = emails[i];
        if (r.status === "fulfilled") {
          console.log(
            `[draft test-dispatch iporto] ${email} → response:`,
            JSON.stringify(r.value).slice(0, 500)
          );
          responses.push({ email, body: r.value });
          const mid = extractMessageId(r.value);
          if (mid) messageIds.push(mid);
        } else {
          const e = r.reason as { message?: string };
          const msg = e?.message ?? "erro desconhecido";
          console.error(`[draft test-dispatch iporto] ${email} → erro:`, msg);
          errors.push(msg);
        }
      }
      // Sem message_id E sem erro = iPORTO aceitou silenciosamente
      // mas não enfileirou. Suspeitos: suppression list, domínio não
      // verificado, quota estourada. Surface como falha clara.
      if (messageIds.length === 0) {
        if (errors.length > 0) {
          return NextResponse.json(
            { error: `iPORTO rejeitou o teste: ${errors[0]}`, details: errors },
            { status: 502 }
          );
        }
        return NextResponse.json(
          {
            error:
              "iPORTO respondeu 200 OK mas sem message_id. Provavelmente: domínio do remetente não verificado, e-mail na lista de supressão (marcou spam antes?), ou quota estourada. Resposta crua abaixo.",
            iporto_responses: responses,
          },
          { status: 502 }
        );
      }
      return NextResponse.json({
        ok: true,
        provider: "iporto",
        iporto_message_ids: messageIds,
        iporto_responses: responses,
        sent_to: emails,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // Locaweb (default)
    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const short = dispatchId.replace(/-/g, "").slice(0, 8);

    let listIds: Array<string | number>;
    let testListNames: string[];
    try {
      const lists = await Promise.all(
        emails.map((email) => ensureTestList({ creds: creds.creds, email }))
      );
      listIds = lists.map((l) => l.list_id);
      testListNames = lists.map((l) => l.list_name);
    } catch (err) {
      return NextResponse.json(
        { error: `Falha ao preparar lista de teste: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    const todayBrt = (() => {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() - 3);
      return d.toISOString().slice(0, 10);
    })();
    const campaignName = `test_draft_${draft.id.slice(0, 8)}_${short}`;

    let messageRef;
    try {
      messageRef = await createMessage(creds.creds, {
        name: campaignName,
        subject,
        sender: creds.sender_email,
        sender_name: creds.sender_name,
        domain_id: creds.domain_id,
        html_body: html,
        list_ids: listIds,
        scheduled_to: todayBrt,
      });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      console.error("[draft test-dispatch] Locaweb createMessage failed:", e);
      return NextResponse.json(
        { error: `Locaweb rejeitou o teste: ${e.message ?? "erro desconhecido"}` },
        { status: 502 }
      );
    }

    const messageId =
      messageRef.id ??
      (typeof messageRef._location === "string"
        ? messageRef._location.split("/").filter(Boolean).pop() ?? null
        : null);

    return NextResponse.json({
      ok: true,
      provider: "locaweb",
      locaweb_message_id: messageId,
      sent_to: emails,
      list_ids: listIds.map(String),
      list_names: testListNames,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
