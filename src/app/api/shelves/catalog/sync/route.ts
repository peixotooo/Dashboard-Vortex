import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { syncCatalog } from "@/lib/shelves/catalog-sync";
import { syncMedusaCatalog } from "@/lib/shelves/medusa-catalog-sync";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    // ?source=medusa roda o sync da loja nova (app.bulking.com.br).
    // Default (sem param) = vnda, comportamento idêntico ao anterior.
    const source = new URL(request.url).searchParams.get("source");

    if (source === "medusa") {
      const result = await syncMedusaCatalog(workspaceId);
      return NextResponse.json({
        ok: true,
        source: "medusa",
        synced: result.synced,
        errors: result.errors,
        skippedNoVndaId: result.skippedNoVndaId,
        total: result.total,
      });
    }

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
