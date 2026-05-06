// src/app/api/crm/email-templates/reports/sync/route.ts
//
// Manual on-demand stats sync triggered by the "Atualizar" button on the
// Reports page. Same logic as the email-templates-stats-sync cron, but
// scoped to the caller's workspace and authorized via the regular
// session/workspace context (no CRON_SECRET needed). Lets the user pull
// fresh Locaweb numbers between cron ticks.

import { NextRequest } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { runStatsSync } from "@/lib/email-templates/stats-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    return await runStatsSync({ workspaceId });
  } catch (err) {
    return handleAuthError(err);
  }
}
