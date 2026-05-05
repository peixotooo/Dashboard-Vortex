// src/app/api/crm/email-templates/[id]/test-dispatch/route.ts
//
// Sends a *preview* of a suggestion to a small set of email addresses (by
// default the logged-in user's). The point is to let the user see how the
// email actually renders in their inbox before firing it at the real
// audience. No stats are persisted to email_template_dispatches and the
// suggestion stays in `pending` — this is ephemeral.
//
// Implementation: spin up a throwaway Locaweb list named
// `_test_<short_dispatchId>`, push the test contacts, and dispatch through
// the same createMessage path the real send uses (so the rendered HTML,
// UTMs, and headers match exactly what the audience would receive).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import {
  createList,
  addContactsToList,
  createMessage,
} from "@/lib/locaweb/email-marketing";
import { applyUtmTracking, buildCampaignSlug } from "@/lib/email-templates/tracking";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** Recipient addresses for the preview. Usually the logged-in user. */
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

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    const dispatchId = randomUUID();
    const short = dispatchId.replace(/-/g, "").slice(0, 8);
    const listName = `_test_${short}`;

    let listId: string | number;
    try {
      const list = await createList(creds.creds, listName);
      const id = list.id ??
        (typeof list._location === "string"
          ? list._location.split("/").filter(Boolean).pop() ?? null
          : null);
      if (id == null) throw new Error("Locaweb não retornou id da lista de teste.");
      listId = id;
      await addContactsToList(
        creds.creds,
        listId,
        emails.map((email) => ({ email }))
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Falha ao preparar lista de teste: ${(err as Error).message}` },
        { status: 502 }
      );
    }

    // Stamp UTMs with a `-test` suffix so any clicks during preview don't
    // poison real-campaign attribution in GA4.
    const campaignSlug =
      buildCampaignSlug({
        kind: "suggestion",
        date: s.generated_for_date,
        slot: s.slot,
        source_id: s.id,
      }) + "-test";
    const html = applyUtmTracking(s.rendered_html, {
      campaign: campaignSlug,
      id: dispatchId,
    });

    const todayBrt = (() => {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() - 3);
      return d.toISOString().slice(0, 10);
    })();

    const subject =
      `[TESTE] ${s.copy?.subject || s.product_snapshot?.name || "Bulking"}`;
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
        list_ids: [listId],
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
      locaweb_message_id: messageId,
      sent_to: emails,
      list_id: String(listId),
      list_name: listName,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
