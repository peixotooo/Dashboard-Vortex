// src/app/api/crm/email-templates/drafts/[id]/dispatch/route.ts
//
// Sends a draft as a Locaweb campaign. Re-renders the draft to clean HTML
// (no editor instrumentation), creates the message via Locaweb's API, and
// records the resulting message_id in email_template_dispatches so the
// stats-sync cron can roll up open/click/bounce data later.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { renderDraft } from "@/lib/email-templates/editor/render";
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import type { Draft } from "@/lib/email-templates/editor/schema";
import type { TreeDraft, SectionNode } from "@/lib/email-templates/tree/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  list_ids: string[];
  /** Optional ISO date YYYY-MM-DD (Locaweb supports daily granularity). */
  scheduled_to?: string;
  /** Override the draft's name → campaign name. Default: draft.name. */
  campaign_name?: string;
  /** Override sender email. Default: workspace's default. */
  sender_email?: string;
  /** Override sender name. Default: workspace's default. */
  sender_name?: string;
  /** Optional reference to the source suggestion (for stats reconciliation). */
  suggestion_id?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as Body;

    if (!Array.isArray(body.list_ids) || body.list_ids.length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos uma lista da Locaweb." },
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
      return NextResponse.json(
        { error: `Falha ao renderizar HTML: ${(err as Error).message}` },
        { status: 500 }
      );
    }

    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }

    const subject = draft.meta?.subject || draft.name || "Bulking";
    const campaignName =
      body.campaign_name ?? `tpl_${draft.id.slice(0, 8)}_${draft.name.slice(0, 50)}`;

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
    const effectiveScheduledTo = body.scheduled_to ?? todayBrt;

    let messageRef;
    try {
      messageRef = await createMessage(creds.creds, {
        name: campaignName,
        subject,
        sender: body.sender_email ?? creds.sender_email,
        sender_name: body.sender_name ?? creds.sender_name,
        domain_id: creds.domain_id,
        html_body: html,
        list_ids: body.list_ids,
        scheduled_to: effectiveScheduledTo,
      });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      console.error("[dispatch] Locaweb createMessage failed:", e);
      return NextResponse.json(
        {
          error: `Locaweb rejeitou o envio: ${e.message ?? "erro desconhecido"}`,
          status: e.status,
        },
        { status: 502 }
      );
    }

    // Locaweb returns a Location header pointing at the message; extract the
    // id (last path segment) when the body doesn't carry it.
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
        workspace_id: workspaceId,
        draft_id: draft.id,
        suggestion_id: body.suggestion_id ?? null,
        locaweb_message_id: messageId,
        locaweb_list_ids: body.list_ids,
        scheduled_to: body.scheduled_to
          ? new Date(`${body.scheduled_to}T00:00:00`).toISOString()
          : null,
        status: initialStatus,
      })
      .select()
      .single();
    if (insErr) {
      console.error("[dispatch] dispatch row insert failed:", insErr);
      // Locaweb already accepted the campaign; surface the issue but don't
      // pretend the dispatch failed.
      return NextResponse.json(
        {
          ok: true,
          locaweb_message_id: messageId,
          status: initialStatus,
          warn: `Email enviado pra Locaweb mas falhou ao registrar localmente: ${insErr.message}`,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      dispatch_id: dispatchRow.id,
      locaweb_message_id: messageId,
      status: initialStatus,
      scheduled_to: body.scheduled_to ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
