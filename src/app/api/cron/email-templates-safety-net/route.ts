// src/app/api/cron/email-templates-safety-net/route.ts
//
// Hourly safety net for the daily email-templates pipeline. Walks every
// enabled workspace and re-runs generateForWorkspace for any workspace
// that has fewer than 3 suggestions for today. Combined with the daily
// 06:00 cron's 3-day buffer, this means the dashboard never shows the
// "Nenhuma sugestão pra hoje" empty state — if morning generation
// short-circuits (GA4 hiccup, transient picker miss, etc.), the next
// hourly tick fills the gap.
//
// Cheap call: idempotent at the orchestrator level (skips workspaces that
// already have 3), and cooldown-tiered at the picker level (degrades
// rather than returning empty). Worst case: a few wasted DB reads per
// hour per workspace.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generateForWorkspace } from "@/lib/email-templates/orchestrator";
import { listEnabledWorkspaces } from "@/lib/email-templates/settings";

export const maxDuration = 300;

function todayBrt(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const date = todayBrt();
  const workspaces = await listEnabledWorkspaces();
  const sb = createAdminClient();
  const recovered: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];

  for (const workspace_id of workspaces) {
    const { count } = await sb
      .from("email_template_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace_id)
      .eq("generated_for_date", date);
    if ((count ?? 0) >= 3) {
      skipped.push(workspace_id);
      continue;
    }
    try {
      const out = await generateForWorkspace(workspace_id, { date });
      recovered.push({
        workspace_id,
        previous_count: count ?? 0,
        slots_filled: out.results.filter((r) => r.ok).map((r) => r.slot),
        slots_skipped: out.results
          .filter((r) => !r.ok)
          .map((r) => ({ slot: r.slot, reason: r.reason })),
      });
    } catch (err) {
      recovered.push({
        workspace_id,
        previous_count: count ?? 0,
        error: String((err as Error).message),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    date,
    workspaces_total: workspaces.length,
    skipped: skipped.length,
    recovered: recovered.length,
    detail: recovered,
  });
}
