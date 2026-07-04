import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { syncCatalog } from "@/lib/shelves/catalog-sync";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const result = await syncCatalog(workspaceId);

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      errors: result.errors,
      total: result.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Catalog Sync]", message);
    return handleAuthError(error);
  }
}
