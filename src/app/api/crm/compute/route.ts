import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateRfmReport, generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";

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

    // Fetch all CRM rows (paginated)
    const allRows: CrmVendaRow[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("crm_vendas")
        .select("cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Supabase error: ${error.message}`);

      if (data && data.length > 0) {
        allRows.push(...(data as CrmVendaRow[]));
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    if (allRows.length === 0) {
      // Clear snapshot if no data
      await supabase
        .from("crm_rfm_snapshots")
        .delete()
        .eq("workspace_id", workspaceId);

      return NextResponse.json({ ok: true, rowCount: 0, computedAt: new Date().toISOString() });
    }

    // Compute RFM report
    const report = generateRfmReport(allRows);

    // Compute monthly cohort
    const cohort = generateMonthlyCohort(allRows);

    // Upsert snapshot
    const { error: upsertError } = await supabase
      .from("crm_rfm_snapshots")
      .upsert(
        {
          workspace_id: workspaceId,
          summary: report.summary,
          segments: report.segments,
          distributions: report.distributions,
          behavioral: report.behavioralDistributions,
          customers: report.customers,
          cohort_metrics: {
            arpu: cohort.arpu,
            avgOrdersPerClient: cohort.avgOrdersPerClient,
            repurchaseRate: cohort.repurchaseRate,
            newClients: cohort.newClients,
            totalClients: cohort.totalClients,
            totalRevenue: cohort.totalRevenue,
          },
          cohort_monthly: cohort.monthlyData,
          row_count: allRows.length,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      );

    if (upsertError) {
      throw new Error(`Snapshot upsert error: ${upsertError.message}`);
    }

    return NextResponse.json({
      ok: true,
      rowCount: allRows.length,
      customerCount: report.customers.length,
      computedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Compute] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
