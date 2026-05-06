// src/app/api/cron/email-templates-stats-sync/route.ts
//
// Periodically polls Locaweb for delivery stats on every dispatched campaign
// in the last 30 days and rolls the result into email_template_dispatches.stats.
// Locaweb has no webhooks, so this is the only way to surface open / click /
// bounce numbers in the dashboard.
//
// Schedule (vercel.json): every 6 hours. Implementation lives in
// lib/email-templates/stats-sync.ts so the workspace-scoped /reports/sync
// endpoint can reuse it without importing across route handlers (which
// Next.js forbids).

import { NextRequest, NextResponse } from "next/server";
import { runStatsSync } from "@/lib/email-templates/stats-sync";

export const maxDuration = 300;

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
  return runStatsSync({});
}
