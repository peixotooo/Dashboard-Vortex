import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { recomputeRfmSnapshot } from "@/lib/crm-compute";

export const maxDuration = 120;

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
    }
  );
}

/**
 * POST /api/crm/compute
 *
 * Recomputes the RFM snapshot for the workspace.
 * Called after CSV import, webhook ingest, or manual trigger.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

    const result = await recomputeRfmSnapshot(supabase, workspaceId);

    return NextResponse.json({
      ok: true,
      rowCount: result.rowCount,
      customerCount: result.customerCount,
      computedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Compute] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
