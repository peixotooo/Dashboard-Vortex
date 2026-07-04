import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { recomputeRfmSnapshot } from "@/lib/crm-compute";

export const maxDuration = 120;

/**
 * POST /api/crm/compute
 *
 * Recomputes the RFM snapshot for the workspace.
 * Called after CSV import, webhook ingest, or manual trigger.
 */
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const result = await recomputeRfmSnapshot(admin, workspaceId);

    return NextResponse.json({
      ok: true,
      rowCount: result.rowCount,
      customerCount: result.customerCount,
      computedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Compute] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
