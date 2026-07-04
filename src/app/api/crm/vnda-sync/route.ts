import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { runVndaCrmImport } from "@/lib/crm/vnda-import";

export const maxDuration = 300;

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
    const { workspaceId } = await getWorkspaceContext(request);

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
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
