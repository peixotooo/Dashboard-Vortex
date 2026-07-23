import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncCatalog } from "@/lib/shelves/catalog-sync";
import { syncMedusaCatalog } from "@/lib/shelves/medusa-catalog-sync";
import { getMedusaEnv } from "@/lib/shelves/medusa-api";
import { shelfSourceColumnsAvailable } from "@/lib/shelves/source";

export const maxDuration = 300;

interface CronSyncResult {
  workspaceId: string;
  source?: string;
  ok: boolean;
  skipped?: string;
  synced?: number;
  errors?: number;
  total?: number;
  elapsedMs?: number;
  error?: string;
}

// Fonte MEDUSA (loja nova): roda em paralelo à VNDA, cada uma protegida pelo
// próprio try/catch — erro numa fonte NUNCA derruba a outra. Workspaces medusa
// = donos de shelf_api_keys com source='medusa' (criada na migration-143).
async function runMedusaSyncs(): Promise<CronSyncResult[]> {
  const results: CronSyncResult[] = [];

  try {
    if (!getMedusaEnv()) {
      return [
        {
          workspaceId: "-",
          source: "medusa",
          ok: true,
          skipped: "MEDUSA_BACKEND_URL / MEDUSA_PUBLISHABLE_KEY not set",
        },
      ];
    }

    if (!(await shelfSourceColumnsAvailable())) {
      return [
        {
          workspaceId: "-",
          source: "medusa",
          ok: true,
          skipped: "migration-143 pending (shelf source columns missing)",
        },
      ];
    }

    const admin = createAdminClient();
    const { data: keys, error } = await admin
      .from("shelf_api_keys")
      .select("workspace_id")
      .eq("source", "medusa")
      .eq("active", true);

    if (error) throw new Error(error.message);

    const workspaceIds = Array.from(
      new Set((keys || []).map((k) => k.workspace_id as string))
    );

    for (const workspaceId of workspaceIds) {
      const t0 = Date.now();
      try {
        const r = await syncMedusaCatalog(workspaceId);
        results.push({
          workspaceId,
          source: "medusa",
          ok: true,
          synced: r.synced,
          errors: r.errors,
          total: r.total,
          elapsedMs: Date.now() - t0,
        });
        console.log(
          `[ShelfCatalogSync] medusa ws=${workspaceId} synced=${r.synced}/${r.total} errors=${r.errors} skippedNoVndaId=${r.skippedNoVndaId} in ${Date.now() - t0}ms`
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        results.push({
          workspaceId,
          source: "medusa",
          ok: false,
          error: message,
          elapsedMs: Date.now() - t0,
        });
        console.error(`[ShelfCatalogSync] medusa ws=${workspaceId} failed: ${message}`);
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    results.push({ workspaceId: "-", source: "medusa", ok: false, error: message });
    console.error(`[ShelfCatalogSync] medusa stage failed: ${message}`);
  }

  return results;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const results: CronSyncResult[] = [];

  // --- Fonte VNDA (loja atual) — comportamento idêntico ao anterior ---
  try {
    // Find all workspaces with at least one VNDA connection
    const { data: connections, error: connErr } = await admin
      .from("vnda_connections")
      .select("workspace_id")
      .order("created_at", { ascending: false });

    if (connErr) throw new Error(connErr.message);

    const uniqueWorkspaceIds = Array.from(
      new Set((connections || []).map((c) => c.workspace_id as string))
    );

    for (const workspaceId of uniqueWorkspaceIds) {
      const t0 = Date.now();
      try {
        const r = await syncCatalog(workspaceId);
        results.push({
          workspaceId,
          source: "vnda",
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
        results.push({
          workspaceId,
          source: "vnda",
          ok: false,
          error: message,
          elapsedMs: Date.now() - t0,
        });
        console.error(`[ShelfCatalogSync] ws=${workspaceId} failed: ${message}`);
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    results.push({ workspaceId: "-", source: "vnda", ok: false, error: message });
    console.error(`[ShelfCatalogSync] vnda stage failed: ${message}`);
  }

  // --- Fonte MEDUSA (loja nova) — paralela, nunca derruba a VNDA ---
  results.push(...(await runMedusaSyncs()));

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
