// src/app/api/crm/email-templates/[id]/dispatch/route.ts
//
// Dispatches a daily-suggestion email directly via Locaweb without forcing
// the user through the editor. Uses the suggestion's rendered_html as-is,
// stamps universal UTM tracking, and persists the resulting message_id to
// email_template_dispatches so the stats-sync cron picks it up.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { createMessage } from "@/lib/locaweb/email-marketing";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml } from "@/lib/email-templates/tracking";
import { materializeSegmentList } from "@/lib/email-templates/segment-list";
import type { Slot } from "@/lib/email-templates/types";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  list_ids: Array<string | number>;
  /** When true, materialize the suggestion's RFM cluster into a Locaweb list
   *  on the fly and append it to list_ids. Lets users dispatch to the
   *  "Champions + Loyal" segmentação the cron suggests without having to
   *  pre-create a matching list in the Locaweb panel. */
  use_segment?: boolean;
  scheduled_to?: string;
  utm_term?: string;
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
    if (manualListIds.length === 0 && !body.use_segment) {
      return NextResponse.json(
        { error: "Selecione ao menos uma lista da Locaweb ou use o segmento sugerido." },
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
      target_segment_payload?: { display_label?: string };
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
