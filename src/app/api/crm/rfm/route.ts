import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { recomputeRfmSnapshot } from "@/lib/crm-compute";

// Snapshot do Bulking já é grande e pode precisar ser reconstruído quando
// uma importação invalida crm_rfm_snapshots. Mantemos folga para recompute
// on-demand em vez de devolver cards zerados ao usuário.
export const maxDuration = 120;

const EMPTY_RESPONSE = {
  customers: [],
  segments: [],
  summary: {
    totalCustomers: 0,
    totalRevenue: 0,
    avgTicket: 0,
    activeCustomers: 0,
    avgPurchasesPerCustomer: 0,
    medianRecency: 0,
  },
  distributions: { recency: [], frequency: [], monetary: [] },
};

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

export async function GET(request: NextRequest) {
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

    const fields = request.nextUrl.searchParams.get("fields");
    const admin = createAdminClient();

    // Try to read from snapshot first
    // For summary view (dashboard), skip the heavy `customers` JSONB column (~35MB)
    const columns = fields === "summary"
      ? "summary, segments, distributions, behavioral, computed_at, row_count"
      : "*";

    interface Snapshot {
      summary: unknown; segments: unknown; distributions: unknown;
      behavioral: unknown; customers?: unknown; computed_at: string;
      row_count?: number;
    }

    async function readSnapshot(): Promise<Snapshot | null> {
      const { data } = await admin
        .from("crm_rfm_snapshots")
        .select(columns)
        .eq("workspace_id", workspaceId)
        .single() as unknown as { data: Snapshot | null };

      return data;
    }

    function snapshotResponse(snapshot: Snapshot) {
      if (fields === "summary") {
        return NextResponse.json({
          segments: snapshot.segments,
          summary: snapshot.summary,
          distributions: snapshot.distributions,
          behavioralDistributions: snapshot.behavioral,
          computedAt: snapshot.computed_at,
        }, {
          headers: { "Cache-Control": "private, max-age=300" },
        });
      }

      return NextResponse.json({
        customers: snapshot.customers,
        segments: snapshot.segments,
        summary: snapshot.summary,
        distributions: snapshot.distributions,
        behavioralDistributions: snapshot.behavioral,
        computedAt: snapshot.computed_at,
      }, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    const snapshot = await readSnapshot();

    if (snapshot) {
      return snapshotResponse(snapshot);
    }

    // Check if workspace has any crm_vendas data at all (single count query)
    const { count } = await admin
      .from("crm_vendas")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (!count || count === 0) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    // No snapshot but there is data: rebuild it now and return the fresh
    // values. This prevents the CRM dashboard from briefly rendering all
    // zeros after a large import deletes the stale snapshot.
    console.log("[CRM RFM] No snapshot found, recomputing on demand.");
    await recomputeRfmSnapshot(admin, workspaceId);

    const recomputedSnapshot = await readSnapshot();
    if (recomputedSnapshot) {
      return snapshotResponse(recomputedSnapshot);
    }

    return NextResponse.json({
      ...EMPTY_RESPONSE,
      pending: true,
      message: "Dados sendo processados. Atualize em alguns minutos.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM RFM] Error:", message);
    return NextResponse.json(
      { ...EMPTY_RESPONSE, error: message },
      { status: 500 }
    );
  }
}
