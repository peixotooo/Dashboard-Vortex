import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { captureGroupSnapshots } from "@/lib/whatsapp/group-snapshot";

// Várias chamadas group-metadata por workspace, com throttle — pode demorar.
export const maxDuration = 300;

// GET /api/cron/whatsapp-group-snapshot
// Diário: para cada workspace com W-API configurada, grava a contagem de
// membros de cada grupo em whatsapp_group_member_snapshots.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const results: Array<{
    workspaceId: string;
    connected?: boolean;
    groups?: number;
    members?: number;
    errors?: number;
    error?: string;
  }> = [];

  try {
    const { data: configs } = await admin.from("wapi_config").select("workspace_id");
    const workspaceIds = Array.from(
      new Set((configs || []).map((c) => c.workspace_id as string))
    );

    if (workspaceIds.length === 0) {
      return NextResponse.json({ message: "Nenhum workspace com W-API", results: [] });
    }

    for (const workspaceId of workspaceIds) {
      try {
        const r = await captureGroupSnapshots(admin, workspaceId, { source: "cron" });
        if (!r.configured) {
          results.push({ workspaceId, error: "W-API não configurada" });
          continue;
        }
        if (!r.connected) {
          results.push({
            workspaceId,
            connected: false,
            groups: 0,
            members: 0,
            errors: r.errors.length,
            error: "W-API desconectada",
          });
          continue;
        }
        results.push({
          workspaceId,
          connected: true,
          groups: r.groupsCaptured,
          members: r.totalMembers,
          errors: r.errors.length,
        });
        console.log(
          `[WA Group Snapshot] ${workspaceId}: ${r.groupsCaptured} grupos, ${r.totalMembers} membros, ${r.errors.length} erros`
        );
      } catch (err) {
        console.error(`[WA Group Snapshot] Erro em ${workspaceId}:`, err);
        results.push({ workspaceId, error: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[WA Group Snapshot] Erro fatal:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
