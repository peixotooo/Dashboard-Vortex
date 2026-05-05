// src/app/api/crm/email-templates/reports/route.ts
//
// Lists every dispatch the workspace has fired, joined with the latest
// stats snapshot from email_template_dispatches.stats. Used by the
// Reports dashboard.
//
// Defensive backfill: prior versions of the stats-sync cron *replaced*
// `stats` with Locaweb's overview, wiping the utm_campaign / utm_term /
// target_segment metadata we seed at dispatch time. Old rows still suffer
// from that. To make the reports table show meaningful labels regardless,
// we look up the linked suggestion (or draft) for each dispatch and
// reconstruct the missing fields on the fly when they aren't present in
// stats.

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
  locaweb_message_id: string;
  locaweb_list_ids: string[];
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
  target_segment_payload?: { display_label?: string } | null;
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
        "id, workspace_id, draft_id, suggestion_id, locaweb_message_id, locaweb_list_ids, scheduled_to, status, stats, last_synced_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const dispatches = (data ?? []) as DispatchRow[];

    // Pull every linked suggestion in a single query so we can backfill
    // missing utm_campaign / target_segment when stats was wiped.
    const suggestionIds = Array.from(
      new Set(
        dispatches
          .map((d) => d.suggestion_id)
          .filter((x): x is string => typeof x === "string")
      )
    );
    const suggestions = new Map<string, SuggestionLite>();
    if (suggestionIds.length > 0) {
      const { data: sugRows } = await sb
        .from("email_template_suggestions")
        .select("id, slot, generated_for_date, target_segment_payload")
        .in("id", suggestionIds);
      for (const s of (sugRows ?? []) as SuggestionLite[]) {
        suggestions.set(s.id, s);
      }
    }

    const enriched = dispatches.map((d) => {
      const stats = (d.stats ?? {}) as Record<string, unknown>;
      let utm_campaign = stats.utm_campaign as string | undefined;
      let utm_term = stats.utm_term as string | undefined;
      let target_segment = stats.target_segment as string | undefined;

      if ((!utm_campaign || !target_segment) && d.suggestion_id) {
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
        }
      }
      if (!utm_campaign && d.draft_id) {
        utm_campaign = buildCampaignSlug({ kind: "draft", source_id: d.draft_id });
      }

      return {
        ...d,
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
