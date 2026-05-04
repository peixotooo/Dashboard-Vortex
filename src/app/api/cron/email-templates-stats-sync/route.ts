// src/app/api/cron/email-templates-stats-sync/route.ts
//
// Periodically polls Locaweb for delivery stats on every dispatched campaign
// in the last 30 days and rolls the result into email_template_dispatches.stats.
// Locaweb has no webhooks, so this is the only way to surface open / click /
// bounce numbers in the dashboard.
//
// Schedule (vercel.json): every 6 hours. Cheap call: only iterates dispatches
// that aren't 'sent' (still being processed) plus dispatches synced > 1h ago,
// up to 30 days old.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getLocawebSettings } from "@/lib/locaweb/settings";
import { getMessage, getMessageOverview } from "@/lib/locaweb/email-marketing";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}

interface DispatchRow {
  id: string;
  workspace_id: string;
  locaweb_message_id: string;
  status: string;
  last_synced_at: string | null;
  created_at: string;
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await sb
    .from("email_template_dispatches")
    .select("id, workspace_id, locaweb_message_id, status, last_synced_at, created_at")
    .gte("created_at", since)
    .neq("status", "canceled")
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const dispatches = (rows ?? []) as DispatchRow[];

  // Cache settings per workspace so we don't re-read them N times.
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
      const stats = overview ?? {};
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
