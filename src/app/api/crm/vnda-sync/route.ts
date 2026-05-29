import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createServerClient } from "@supabase/ssr";
import { runVndaCrmImport } from "@/lib/crm/vnda-import";

export const maxDuration = 300;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    },
  );
}

type SyncBody = {
  startDate?: string;
  endDate?: string;
  status?: string;
  dryRun?: boolean;
  includeClients?: boolean;
  syncContactList?: boolean;
  onlyMissingCustomers?: boolean;
  maxOrderPages?: number;
  maxClientPages?: number;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

    let body: SyncBody = {};
    try {
      body = await request.json();
    } catch {
      // Defaults below.
    }

    const admin = createAdminClient();
    const progress: string[] = [];
    const result = await runVndaCrmImport(admin, {
      workspaceId,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status || "confirmed",
      dryRun: body.dryRun ?? false,
      includeClients: body.includeClients ?? false,
      syncContactList: body.syncContactList ?? false,
      onlyMissingCustomers: body.onlyMissingCustomers ?? false,
      maxOrderPages: body.maxOrderPages,
      maxClientPages: body.maxClientPages,
      onProgress(message) {
        progress.push(message);
        console.log(message);
      },
    });

    return NextResponse.json({
      ...result,
      synced: result.orders.upserted,
      total_fetched: result.orders.fetched,
      batch_errors: result.orders.batchErrors,
      date_range: result.dateRange,
      progress,
      message: result.dryRun
        ? `Dry-run: ${result.orders.eligibleForUpsert} pedidos elegiveis para importar.`
        : `Importacao VNDA concluida: ${result.orders.upserted} pedidos inseridos/atualizados.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
