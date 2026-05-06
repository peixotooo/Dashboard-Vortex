// src/lib/email-templates/stats-sync.ts
//
// Pulls Locaweb overview/status for every dispatch in scope and merges the
// result into email_template_dispatches.stats. Used by:
//   - the email-templates-stats-sync cron (every 6h, full account scope)
//   - the workspace-scoped /reports/sync POST endpoint (manual refresh from
//     the Reports page; restricted to one workspace)
//
// Lives in lib/ rather than inside a route.ts because Next.js route files
// only allow HTTP-handler + config exports — importing a function across
// route handlers fails the Vercel build with "unsupported export".

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getLocawebSettings } from "@/lib/locaweb/settings";
import { getMessage, getMessageOverview } from "@/lib/locaweb/email-marketing";

interface DispatchRow {
  id: string;
  workspace_id: string;
  locaweb_message_id: string;
  status: string;
  stats: Record<string, unknown> | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface RunSyncOptions {
  /** Restrict the sync to a single workspace. Used by the manual /sync
   *  endpoint that runs on demand from the reports page. */
  workspaceId?: string;
}

export async function runStatsSync(opts: RunSyncOptions) {
  const sb = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let q = sb
    .from("email_template_dispatches")
    .select("id, workspace_id, locaweb_message_id, status, stats, last_synced_at, created_at")
    .gte("created_at", since)
    .neq("status", "canceled")
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.workspaceId) {
    q = q.eq("workspace_id", opts.workspaceId);
  }
  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const dispatches = (rows ?? []) as DispatchRow[];

  const settingsCache = new Map<string, Awaited<ReturnType<typeof getLocawebSettings>>>();
  const updates: Array<Record<string, unknown>> = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const d of dispatches) {
    let s = settingsCache.get(d.workspace_id);
    if (!s) {
      s = await getLocawebSettings(d.workspace_id);
      settingsCache.set(d.workspace_id, s);
    }
    if (!s.account_id || !s.token) {
      skipped++;
      continue;
    }
    const creds = {
      base_url: s.base_url,
      account_id: s.account_id,
      token: s.token,
    };
    try {
      const [msg, overview] = await Promise.all([
        getMessage(creds, d.locaweb_message_id).catch(() => null),
        getMessageOverview(creds, d.locaweb_message_id).catch(() => null),
      ]);
      const newStatus = mapStatus(msg?.status, d.status);
      // Merge — never replace. The dispatch insert seeds stats with
      // utm_campaign / utm_id / utm_term / target_segment metadata that
      // the reports dashboard relies on. Locaweb's overview only carries
      // delivery metrics, so a wholesale assignment used to wipe the
      // metadata on every cron tick.
      const prevStats = (d.stats ?? {}) as Record<string, unknown>;
      const stats = { ...prevStats, ...(overview ?? {}) };
      const { error: upErr } = await sb
        .from("email_template_dispatches")
        .update({
          status: newStatus,
          stats,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", d.id);
      if (upErr) failed++;
      else {
        synced++;
        updates.push({ id: d.id, status: newStatus, locaweb_status: msg?.status });
      }
    } catch (err) {
      console.error(`[stats-sync] dispatch ${d.id} failed:`, (err as Error).message);
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: dispatches.length,
    synced,
    skipped,
    failed,
    updates,
  });
}

function mapStatus(locawebStatus: string | undefined, currentStatus: string): string {
  if (!locawebStatus) return currentStatus;
  const lower = locawebStatus.toLowerCase();
  if (lower.includes("sent") || lower.includes("delivered") || lower.includes("finalizad"))
    return "sent";
  if (lower.includes("schedul") || lower.includes("agend")) return "scheduled";
  if (lower.includes("send") || lower.includes("enviand") || lower.includes("queu"))
    return "sending";
  if (lower.includes("fail") || lower.includes("erro")) return "failed";
  if (lower.includes("cancel")) return "canceled";
  return currentStatus;
}
