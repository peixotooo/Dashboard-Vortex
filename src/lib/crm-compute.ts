import { generateRfmReport, generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow } from "@/lib/crm-rfm";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000; // Supabase default max rows per request

/**
 * Recomputes the RFM snapshot for a workspace.
 * Works with both authenticated (user) and admin Supabase clients.
 */
export async function recomputeRfmSnapshot(
  client: SupabaseClient,
  workspaceId: string
): Promise<{ rowCount: number; customerCount: number }> {
  // Fetch all CRM rows (paginated)
  const allRows: CrmVendaRow[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await client
      .from("crm_vendas")
      .select(
        "cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores"
      )
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
    await client
      .from("crm_rfm_snapshots")
      .delete()
      .eq("workspace_id", workspaceId);

    return { rowCount: 0, customerCount: 0 };
  }

  // Compute RFM report
  const report = generateRfmReport(allRows);

  // Compute monthly cohort
  const cohort = generateMonthlyCohort(allRows);

  // Upsert snapshot
  const { error: upsertError } = await client
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

  return { rowCount: allRows.length, customerCount: report.customers.length };
}
