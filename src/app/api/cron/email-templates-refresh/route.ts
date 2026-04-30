import { NextRequest, NextResponse } from "next/server";
import { generateForWorkspace } from "@/lib/email-templates/orchestrator";
import { listEnabledWorkspaces } from "@/lib/email-templates/settings";

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

  const workspaces = await listEnabledWorkspaces();
  const summaries: Array<Record<string, unknown>> = [];

  // Sequential to avoid hammering external APIs (VNDA + GA4) across many
  // workspaces at once. Within a workspace, slots run in parallel
  // (orchestrator's Promise.all).
  for (const workspace_id of workspaces) {
    try {
      const out = await generateForWorkspace(workspace_id);
      summaries.push({
        workspace_id,
        date: out.date,
        slots_filled: out.results.filter((r) => r.ok).map((r) => r.slot),
        slots_skipped: out.results.filter((r) => !r.ok).map((r) => ({ slot: r.slot, reason: r.reason })),
      });
    } catch (err) {
      summaries.push({
        workspace_id,
        error: String((err as Error).message),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: workspaces.length, summaries });
}
