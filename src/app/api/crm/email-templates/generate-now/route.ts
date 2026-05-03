// src/app/api/crm/email-templates/generate-now/route.ts
//
// Workspace-scoped manual trigger for the daily email-templates pipeline.
// Lets the dashboard's "Gerar sugestões agora" button kick off generation
// without waiting for the next cron tick. Auth is via workspace context
// (not CRON_SECRET) so any admin of the workspace can trigger it.
//
// `force: true` is passed so the orchestrator regenerates even if there are
// already < 3 suggestions in a partial state (e.g. one slot succeeded
// earlier and others are missing).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { syncCatalog } from "@/lib/shelves/catalog-sync";
import { generateForWorkspace } from "@/lib/email-templates/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);

    // Refresh shelf first so the picker reads current prices/stock.
    let shelfSynced: number | undefined;
    try {
      const result = (await syncCatalog(workspaceId)) as { synced?: number };
      shelfSynced = result.synced;
    } catch (err) {
      console.error("[generate-now] shelf sync failed:", (err as Error).message);
    }

    const out = await generateForWorkspace(workspaceId, { force: true });

    return NextResponse.json({
      ok: true,
      date: out.date,
      shelf_synced: shelfSynced,
      slots_filled: out.results.filter((r) => r.ok).map((r) => r.slot),
      slots_skipped: out.results
        .filter((r) => !r.ok)
        .map((r) => ({ slot: r.slot, reason: r.reason })),
    });
  } catch (err) {
    console.error("[generate-now] failed:", err);
    return handleAuthError(err);
  }
}
