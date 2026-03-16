import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { recomputeRfmSnapshot } from "@/lib/crm-compute";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find workspaces that have crm_vendas data but no snapshot
    const { data: staleWorkspaces, error } = await admin.rpc("get_workspaces_without_rfm_snapshot");

    // Fallback: if the RPC doesn't exist, query manually
    let workspaceIds: string[] = [];

    if (error || !staleWorkspaces) {
      // Manual query: workspaces with vendas and (no snapshot OR stale snapshot)
      const { data: withVendas } = await admin
        .from("crm_vendas")
        .select("workspace_id")
        .limit(1000);

      const uniqueWs = [...new Set((withVendas || []).map((r) => r.workspace_id as string))];

      if (uniqueWs.length > 0) {
        // Find snapshots for these workspaces
        const { data: snapshots } = await admin
          .from("crm_rfm_snapshots")
          .select("workspace_id, computed_at")
          .in("workspace_id", uniqueWs);

        const snapshotMap = new Map(
          (snapshots || []).map((s) => [s.workspace_id as string, s.computed_at as string])
        );

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        workspaceIds = uniqueWs.filter((id) => {
          const lastComputed = snapshotMap.get(id);
          // Include if:
          // 1. No snapshot exists
          // 2. Snapshot is older than 24h
          return !lastComputed || lastComputed < oneDayAgo;
        });
      }
    } else {
      workspaceIds = (staleWorkspaces as { workspace_id: string }[]).map((r) => r.workspace_id);
    }

    if (workspaceIds.length === 0) {
      return NextResponse.json({ recomputed: 0, message: "All snapshots up to date" });
    }

    const results: { workspaceId: string; rowCount: number; customerCount: number }[] = [];
    const CONCURRENCY = 3;

    // Process workspaces in parallel batches of CONCURRENCY
    for (let i = 0; i < workspaceIds.length; i += CONCURRENCY) {
      const batch = workspaceIds.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (workspaceId) => {
          const result = await recomputeRfmSnapshot(admin, workspaceId);
          console.log(
            `[CRM Recompute] Workspace ${workspaceId}: ${result.customerCount} customers from ${result.rowCount} rows`
          );
          return { workspaceId, ...result };
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          console.error(`[CRM Recompute] Error:`, r.reason instanceof Error ? r.reason.message : r.reason);
        }
      }
    }

    return NextResponse.json({ recomputed: results.length, results });
  } catch (error) {
    console.error("[CRM Recompute]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
