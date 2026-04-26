import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncCatalog } from "@/lib/shelves/catalog-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all workspaces with at least one VNDA connection
  const { data: connections, error: connErr } = await admin
    .from("vnda_connections")
    .select("workspace_id")
    .order("created_at", { ascending: false });

  if (connErr) {
    console.error("[ShelfCatalogSync] Failed to load connections:", connErr.message);
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  const uniqueWorkspaceIds = Array.from(
    new Set((connections || []).map((c) => c.workspace_id as string))
  );

  if (uniqueWorkspaceIds.length === 0) {
    return NextResponse.json({ processed: 0, message: "No VNDA-connected workspaces" });
  }

  const results: Array<{
    workspaceId: string;
    ok: boolean;
    synced?: number;
    errors?: number;
    total?: number;
    elapsedMs?: number;
    error?: string;
  }> = [];

  for (const workspaceId of uniqueWorkspaceIds) {
    const t0 = Date.now();
    try {
      const r = await syncCatalog(workspaceId);
      results.push({
        workspaceId,
        ok: true,
        synced: r.synced,
        errors: r.errors,
        total: r.total,
        elapsedMs: Date.now() - t0,
      });
      console.log(
        `[ShelfCatalogSync] ws=${workspaceId} synced=${r.synced}/${r.total} errors=${r.errors} in ${Date.now() - t0}ms`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      results.push({ workspaceId, ok: false, error: message, elapsedMs: Date.now() - t0 });
      console.error(`[ShelfCatalogSync] ws=${workspaceId} failed: ${message}`);
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
