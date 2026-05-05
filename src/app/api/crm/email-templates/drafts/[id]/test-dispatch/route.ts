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
import {
  createList,
  addContactsToList,
  createMessage,
} from "@/lib/locaweb/email-marketing";
import { renderDraft } from "@/lib/email-templates/editor/render";
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml } from "@/lib/email-templates/tracking";
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
      const listIdRaw = list.id ??
        (typeof list._location === "string"
          ? list._location.split("/").filter(Boolean).pop() ?? null
          : null);
      if (listIdRaw == null) throw new Error("Locaweb não retornou id da lista de teste.");
      listId = listIdRaw;
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

    // -test suffix in the campaign slug so any clicks during preview don't
    // mix into real-campaign attribution in GA4.
    const campaignSlug =
      buildCampaignSlug({ kind: "draft", source_id: draft.id }) + "-test";
    html = sanitizeEmailHtml(
      applyUtmTracking(html, {
        campaign: campaignSlug,
        id: dispatchId,
      })
    );

    const todayBrt = (() => {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() - 3);
      return d.toISOString().slice(0, 10);
    })();

    const subject = `[TESTE] ${draft.meta?.subject || draft.name || "Bulking"}`;
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
        list_ids: [listId],
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
      locaweb_message_id: messageId,
      sent_to: emails,
      list_id: String(listId),
      list_name: listName,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
