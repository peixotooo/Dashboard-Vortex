// src/app/api/crm/email-templates/[id]/test-dispatch/route.ts
//
// Sends a *preview* of a suggestion to a small set of email addresses (by
// default the logged-in user's). The point is to let the user see how the
// email actually renders in their inbox before firing it at the real
// audience. No stats are persisted to email_template_dispatches and the
// suggestion stays in `pending` — this is ephemeral.
//
// Reuses a stable per-recipient Locaweb list ("Vortex · Teste · <email>")
// via ensureTestList so the panel doesn't pile up hundreds of throwaway
// lists from repeated previews. Dispatches via the same createMessage
// path the real send uses (so the rendered HTML, UTMs, and headers match
// exactly what the audience would receive).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { getIportoReadyCreds } from "@/lib/iporto/settings";
import { createDelivery, extractMessageId } from "@/lib/iporto/email-marketing";
import { getActiveProvider, getWorkspaceHomeUrl } from "@/lib/email-providers";
import { ensureTestList } from "@/lib/email-templates/test-list";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml, wrapUnlinkedImages } from "@/lib/email-templates/tracking";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** Recipient addresses for the preview. Usually the logged-in user. */
  test_emails: string[];
  /** Subject editado no diálogo. Quando presente, usa esse em vez do que
   *  estava salvo na sugestão — sem isso o "Enviar teste" sempre manda
   *  com o subject antigo, dando a impressão de que a edição não pegou. */
  subject_override?: string;
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
      product_snapshot?: { name?: string };
    };
    const s = sug as unknown as SugRow;

    if (!s.rendered_html) {
      return NextResponse.json(
        { error: "Sugestão sem rendered_html." },
        { status: 400 }
      );
    }

    const dispatchId = randomUUID();
    const campaignSlug =
      buildCampaignSlug({
        kind: "suggestion",
        date: s.generated_for_date,
        slot: s.slot,
        source_id: s.id,
      }) + "-test";
    const homeUrl = await getWorkspaceHomeUrl(workspaceId);
    const html = sanitizeEmailHtml(
      applyUtmTracking(wrapUnlinkedImages(s.rendered_html, homeUrl), {
        campaign: campaignSlug,
        id: dispatchId,
      })
    );
    const baseSubject =
      (typeof body.subject_override === "string" && body.subject_override.trim()) ||
      s.copy?.subject ||
      s.product_snapshot?.name ||
      "Bulking";
    const subject = `[TESTE] ${baseSubject}`;

    // Ramifica pelo provider ativo do workspace (test send precisa usar
    // o mesmo canal do real, senão o usuário valida no provider errado).
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
            // track_link OFF — iPORTO injeta utm_source=iPORTO/utm_medium=smtp
            // por cima das nossas UTMs, gerando duplicidade que o próprio
            // track server rejeita. Nossas UTMs vão direto pro GA4.
            tracking_settings: { track_open: "yes", track_link: "no" },
          })
        )
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const email = emails[i];
        if (r.status === "fulfilled") {
          console.log(
            `[suggestion test-dispatch iporto] ${email} → response:`,
            JSON.stringify(r.value).slice(0, 500)
          );
          responses.push({ email, body: r.value });
          const mid = extractMessageId(r.value);
          if (mid) messageIds.push(mid);
        } else {
          const e = r.reason as { message?: string };
          const msg = e?.message ?? "erro desconhecido";
          console.error(
            `[suggestion test-dispatch iporto] ${email} → erro:`,
            msg
          );
          errors.push(msg);
        }
      }
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
    const short = dispatchId.replace(/-/g, "").slice(0, 8);
    const campaignName = `test_${s.slot}_${s.generated_for_date}_${short}`;

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
      console.error("[test-dispatch] Locaweb createMessage failed:", e);
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
