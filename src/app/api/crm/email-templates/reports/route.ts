// src/app/api/crm/email-templates/reports/route.ts
//
// Lista todos os dispatches do workspace nos últimos N dias com stats
// + provider + recipients counts + nomes das listas (audiência) pra
// alimentar a tela /reports.
//
// Backfill defensivo: stats-sync antigo às vezes sobrescrevia o campo
// stats com a overview da Locaweb, perdendo utm_campaign/utm_term/
// target_segment. Reconstruímos esses campos olhando suggestion/draft
// quando faltam.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildCampaignSlug } from "@/lib/email-templates/tracking";

export const runtime = "nodejs";

interface DispatchRow {
  id: string;
  workspace_id: string;
  draft_id: string | null;
  suggestion_id: string | null;
  provider: string | null;
  locaweb_message_id: string | null;
  locaweb_list_ids: string[] | null;
  iporto_message_ids: string[] | null;
  recipients_total: number | null;
  recipients_sent: number | null;
  recipients_failed: number | null;
  subject: string | null;
  scheduled_to: string | null;
  status: string;
  stats: Record<string, unknown> | null;
  last_synced_at: string | null;
  created_at: string;
}

interface SuggestionLite {
  id: string;
  slot: number;
  generated_for_date: string;
  copy?: { subject?: string } | null;
  target_segment_payload?: { display_label?: string } | null;
}

interface DraftLite {
  id: string;
  name: string;
  meta?: { subject?: string } | null;
}

interface AudienceLite {
  locaweb_list_id: string | null;
  name: string;
  total_count: number | null;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const url = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") ?? "30", 10) || 30, 1),
      365
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("email_template_dispatches")
      .select(
        "id, workspace_id, draft_id, suggestion_id, provider, locaweb_message_id, locaweb_list_ids, iporto_message_ids, recipients_total, recipients_sent, recipients_failed, subject, scheduled_to, status, stats, last_synced_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const dispatches = (data ?? []) as DispatchRow[];

    // Pull linked suggestions + drafts pra reconstruir subject/utm/segment.
    const suggestionIds = Array.from(
      new Set(
        dispatches
          .map((d) => d.suggestion_id)
          .filter((x): x is string => typeof x === "string")
      )
    );
    const draftIds = Array.from(
      new Set(
        dispatches
          .map((d) => d.draft_id)
          .filter((x): x is string => typeof x === "string")
      )
    );

    const suggestions = new Map<string, SuggestionLite>();
    if (suggestionIds.length > 0) {
      const { data: sugRows } = await sb
        .from("email_template_suggestions")
        .select("id, slot, generated_for_date, copy, target_segment_payload")
        .in("id", suggestionIds);
      for (const s of (sugRows ?? []) as SuggestionLite[]) {
        suggestions.set(s.id, s);
      }
    }

    const drafts = new Map<string, DraftLite>();
    if (draftIds.length > 0) {
      const { data: dRows } = await sb
        .from("email_template_drafts")
        .select("id, name, meta")
        .in("id", draftIds);
      for (const d of (dRows ?? []) as DraftLite[]) {
        drafts.set(d.id, d);
      }
    }

    // Pull todas as audiências do workspace pra mapear list_id → nome.
    // Single query — cheap.
    const audienceByListId = new Map<string, AudienceLite>();
    const { data: audRows } = await sb
      .from("email_template_audiences")
      .select("locaweb_list_id, name, total_count")
      .eq("workspace_id", workspaceId);
    for (const a of (audRows ?? []) as AudienceLite[]) {
      if (a.locaweb_list_id) {
        audienceByListId.set(String(a.locaweb_list_id), a);
      }
    }

    const enriched = dispatches.map((d) => {
      const stats = (d.stats ?? {}) as Record<string, unknown>;
      let utm_campaign = stats.utm_campaign as string | undefined;
      let utm_term = stats.utm_term as string | undefined;
      let target_segment = stats.target_segment as string | undefined;
      let subject = d.subject ?? (stats.subject as string | undefined);

      if (d.suggestion_id) {
        const s = suggestions.get(d.suggestion_id);
        if (s) {
          if (!utm_campaign) {
            utm_campaign = buildCampaignSlug({
              kind: "suggestion",
              date: s.generated_for_date,
              slot: s.slot,
              source_id: s.id,
            });
          }
          if (!target_segment) {
            target_segment = s.target_segment_payload?.display_label ?? undefined;
          }
          if (!utm_term) {
            utm_term = s.target_segment_payload?.display_label ?? undefined;
          }
          if (!subject) {
            subject = s.copy?.subject ?? undefined;
          }
        }
      }
      if (d.draft_id) {
        const dr = drafts.get(d.draft_id);
        if (dr) {
          if (!utm_campaign) {
            utm_campaign = buildCampaignSlug({ kind: "draft", source_id: dr.id });
          }
          if (!subject) {
            subject = dr.meta?.subject ?? dr.name ?? undefined;
          }
        }
      }

      // Nomes das listas usadas (pra UI mostrar "Lista X · Y contatos").
      const audienceLists = (d.locaweb_list_ids ?? []).map((lid) => {
        const a = audienceByListId.get(String(lid));
        return {
          list_id: String(lid),
          name: a?.name ?? `Lista ${lid}`,
          count: a?.total_count ?? null,
        };
      });

      return {
        id: d.id,
        provider: d.provider ?? "locaweb",
        subject: subject ?? null,
        status: d.status,
        scheduled_to: d.scheduled_to,
        created_at: d.created_at,
        last_synced_at: d.last_synced_at,
        recipients_total: d.recipients_total ?? null,
        recipients_sent: d.recipients_sent ?? null,
        recipients_failed: d.recipients_failed ?? null,
        locaweb_message_id: d.locaweb_message_id,
        locaweb_list_ids: d.locaweb_list_ids ?? [],
        audience_lists: audienceLists,
        suggestion_id: d.suggestion_id,
        draft_id: d.draft_id,
        stats: {
          ...stats,
          utm_campaign: utm_campaign ?? null,
          utm_term: utm_term ?? null,
          target_segment: target_segment ?? null,
        },
      };
    });

    return NextResponse.json({ dispatches: enriched });
  } catch (err) {
    return handleAuthError(err);
  }
}
