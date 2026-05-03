// src/app/api/cron/email-templates-refresh/route.ts
//
// Daily 06:00 BRT cron. Two responsibilities, in order:
//   1) Refresh shelf_products from VNDA so price/stock are current — the
//      orchestrator's pickers read shelf_products, so a stale mirror means
//      yesterday's prices and last-week's out-of-stock products in today's
//      emails.
//   2) Generate suggestions for a 3-day window (today + tomorrow + day-after)
//      so any single failed slot doesn't leave a workspace empty the next
//      morning. Idempotent: workspaces that already have 3 suggestions for a
//      given date are skipped (handled inside generateForWorkspace).

import { NextRequest, NextResponse } from "next/server";
import { generateForWorkspace } from "@/lib/email-templates/orchestrator";
import { listEnabledWorkspaces } from "@/lib/email-templates/settings";
import { syncCatalog } from "@/lib/shelves/catalog-sync";

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

function dateOffset(days: number): string {
  // BRT = UTC-3, no DST.
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  brt.setUTCDate(brt.getUTCDate() + days);
  return brt.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspaces = await listEnabledWorkspaces();
  const summaries: Array<Record<string, unknown>> = [];

  // Step 1: refresh shelves for every enabled workspace BEFORE generating
  // emails, so the picker reads fresh price/stock/availability.
  const shelfSummaries: Array<Record<string, unknown>> = [];
  for (const workspace_id of workspaces) {
    try {
      const result = await syncCatalog(workspace_id);
      shelfSummaries.push({
        workspace_id,
        synced: (result as { synced?: number }).synced,
      });
    } catch (err) {
      shelfSummaries.push({ workspace_id, error: String((err as Error).message) });
    }
  }

  // Step 2: generate for today + tomorrow + day-after. Workspaces that
  // already have 3 suggestions for a given date are short-circuited inside
  // generateForWorkspace (idempotent).
  const targetDates = [dateOffset(0), dateOffset(1), dateOffset(2)];

  for (const workspace_id of workspaces) {
    const wsSummary: Record<string, unknown> = { workspace_id, days: {} };
    for (const date of targetDates) {
      try {
        const out = await generateForWorkspace(workspace_id, { date });
        (wsSummary.days as Record<string, unknown>)[date] = {
          slots_filled: out.results.filter((r) => r.ok).map((r) => r.slot),
          slots_skipped: out.results
            .filter((r) => !r.ok)
            .map((r) => ({ slot: r.slot, reason: r.reason })),
          // results: [] means the workspace already had 3 suggestions for
          // that date — pre-populated by yesterday's run.
          already_filled: out.results.length === 0,
        };
      } catch (err) {
        (wsSummary.days as Record<string, unknown>)[date] = {
          error: String((err as Error).message),
        };
      }
    }
    summaries.push(wsSummary);
  }

  return NextResponse.json({
    ok: true,
    processed: workspaces.length,
    target_dates: targetDates,
    shelf: shelfSummaries,
    summaries,
  });
}
