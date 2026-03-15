import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { recomputeRfmSnapshot } from "@/lib/crm-compute";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find workspaces that have crm_vendas data but no snapshot
    const { data: staleWorkspaces, error } = await admin.rpc("get_workspaces_without_rfm_snapshot");

    // Fallback: if the RPC doesn't exist, query manually
    let workspaceIds: string[] = [];

    if (error || !staleWorkspaces) {
      // Manual query: workspaces with vendas but no snapshot
      const { data: withVendas } = await admin
        .from("crm_vendas")
        .select("workspace_id")
        .limit(1000);

      const uniqueWs = [...new Set((withVendas || []).map((r) => r.workspace_id as string))];

      if (uniqueWs.length > 0) {
        const { data: withSnapshots } = await admin
          .from("crm_rfm_snapshots")
          .select("workspace_id")
          .in("workspace_id", uniqueWs);

        const snapshotSet = new Set((withSnapshots || []).map((r) => r.workspace_id as string));
        workspaceIds = uniqueWs.filter((id) => !snapshotSet.has(id));
      }
    } else {
      workspaceIds = (staleWorkspaces as { workspace_id: string }[]).map((r) => r.workspace_id);
    }

    if (workspaceIds.length === 0) {
      return NextResponse.json({ recomputed: 0, message: "All snapshots up to date" });
    }

    const results: { workspaceId: string; rowCount: number; customerCount: number }[] = [];

    for (const workspaceId of workspaceIds) {
      try {
        const result = await recomputeRfmSnapshot(admin, workspaceId);
        results.push({ workspaceId, ...result });
        console.log(
          `[CRM Recompute] Workspace ${workspaceId}: ${result.customerCount} customers from ${result.rowCount} rows`
        );
      } catch (err) {
        console.error(
          `[CRM Recompute] Error for workspace ${workspaceId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json({ recomputed: results.length, results });
  } catch (error) {
    console.error("[CRM Recompute]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
