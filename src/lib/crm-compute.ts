import { generateRfmReport, generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow, RfmCustomer, PreferenceCount } from "@/lib/crm-rfm";
import { recomputeAbcSnapshot } from "@/lib/financeiro/recompute";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000; // Supabase default max rows per request
const MAX_RETRIES = 3;

/**
 * Recomputes the RFM snapshot for a workspace.
 * Works with both authenticated (user) and admin Supabase clients.
 */
export async function recomputeRfmSnapshot(
  client: SupabaseClient,
  workspaceId: string
): Promise<{ rowCount: number; customerCount: number }> {
  // Fetch all CRM rows (paginated, with retry on transient Cloudflare 522)
  const allRows: CrmVendaRow[] = [];
  let from = 0;
  let hasMore = true;
  const COLUMNS = "cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores, items, payment_method, installments, shipping_price, discount_price, source_order_id";

  while (hasMore) {
    let attempt = 0;
    let pageData: CrmVendaRow[] | null = null;
    let lastErr: string | null = null;

    while (attempt < MAX_RETRIES && pageData === null) {
      const { data, error } = await client
        .from("crm_vendas")
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE_SIZE - 1);

      if (!error) {
        pageData = (data ?? []) as CrmVendaRow[];
        break;
      }

      // Cloudflare 522 / HTML body / timeout — retry with backoff
      const msg = error.message ?? "";
      const isTransient = msg.includes("522") || msg.includes("Connection timed out") || msg.toLowerCase().includes("<!doctype") || msg.includes("fetch failed");
      lastErr = msg;
      attempt++;

      if (!isTransient || attempt >= MAX_RETRIES) {
        throw new Error(`Supabase error (page ${from}, attempt ${attempt}): ${msg.slice(0, 200)}`);
      }

      const backoff = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s
      console.warn(`[crm-compute] Page ${from} attempt ${attempt} hit transient error, retrying in ${backoff}ms: ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, backoff));
    }

    if (pageData === null) {
      throw new Error(`Failed to fetch page ${from} after ${MAX_RETRIES} retries. Last error: ${lastErr?.slice(0, 200)}`);
    }

    if (pageData.length > 0) {
      allRows.push(...pageData);
      from += PAGE_SIZE;
      hasMore = pageData.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  if (allRows.length === 0) {
    // Don't delete the existing snapshot. If we got 0 rows it's usually
    // because of a transient Supabase issue (null body without error,
    // network blip etc.), not because the workspace genuinely has no
    // sales. Past behavior of deleting on 0 rows caused production-wide
    // CRM dashboards to zero out when the recompute hit a transient
    // empty response. Leaving the stale snapshot in place is strictly
    // safer — users see slightly old numbers vs. all zeros.
    console.warn(
      `[crm-compute] No rows for workspace ${workspaceId} — keeping existing snapshot intact.`
    );
    return { rowCount: 0, customerCount: 0 };
  }

  // Compute RFM report
  const report = generateRfmReport(allRows);

  // Enrich customers with preferredCategories by joining their SKU
  // counts with the workspace's shelf_products. We do this AFTER the
  // RFM report so the data layer (crm-rfm.ts) stays focused on order
  // signals — category lookup belongs at the integration layer
  // because shelf_products is workspace-specific catalog data.
  await enrichCustomerCategories(client, workspaceId, report.customers, allRows);

  // ABC curve + per-order profitability. Computed over the same dataset
  // we just loaded (saves a round-trip), filtered to the last
  // ABC_PERIOD_DAYS so "ABC A" reflects current revenue drivers, not
  // a 5-year-old hit. Best-effort — never fail RFM if ABC fails.
  await recomputeAbcSnapshot(client, workspaceId, allRows).catch((err) => {
    console.error(
      `[crm-compute] ABC recompute failed for workspace ${workspaceId}:`,
      (err as Error).message
    );
  });

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

/**
 * Second-pass enrichment: walk each customer's SKU/product-id counts and
 * resolve them against shelf_products to compute `preferredCategories`.
 * Mutates the customers array in-place. Best-effort — if shelf_products
 * is missing or a SKU isn't in the catalog, we just skip that line.
 */
async function enrichCustomerCategories(
  client: SupabaseClient,
  workspaceId: string,
  customers: RfmCustomer[],
  rows: CrmVendaRow[]
): Promise<void> {
  // Pull a SKU→category map for the workspace. Cap the page size since
  // catalogs can be large; 5k covers Bulking comfortably.
  const skuToCategory = new Map<string, string>();
  const productIdToCategory = new Map<string, string>();
  try {
    const { data } = await client
      .from("shelf_products")
      .select("sku, product_id, category")
      .eq("workspace_id", workspaceId)
      .limit(5000);
    for (const r of (data ?? []) as Array<{
      sku: string | null;
      product_id: string | null;
      category: string | null;
    }>) {
      if (r.category) {
        if (r.sku) skuToCategory.set(r.sku.trim().toLowerCase(), r.category);
        if (r.product_id)
          productIdToCategory.set(r.product_id.trim().toLowerCase(), r.category);
      }
    }
  } catch {
    // Catalog query failed — leave preferredCategories empty.
    return;
  }

  if (skuToCategory.size === 0 && productIdToCategory.size === 0) return;

  // Re-walk the raw items per customer to count categories. Cheaper
  // than asking the RFM aggregator to know about catalogs.
  const counts = new Map<string, Map<string, number>>(); // email → category → count
  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    if (!email) continue;
    const items = Array.isArray(row.items) ? row.items : [];
    if (items.length === 0) continue;
    let bucket = counts.get(email);
    if (!bucket) {
      bucket = new Map();
      counts.set(email, bucket);
    }
    for (const item of items as Array<{
      sku?: string | null;
      reference?: string | null;
      quantity?: number | null;
    }>) {
      const qty = Math.max(1, Number(item.quantity ?? 1));
      const skuKey = item.sku?.trim().toLowerCase();
      const refKey = item.reference?.trim().toLowerCase();
      const cat =
        (skuKey && skuToCategory.get(skuKey)) ||
        (refKey && productIdToCategory.get(refKey)) ||
        null;
      if (!cat) continue;
      bucket.set(cat, (bucket.get(cat) ?? 0) + qty);
    }
  }

  for (const customer of customers) {
    const bucket = counts.get(customer.email);
    if (!bucket) continue;
    const top: PreferenceCount[] = [...bucket.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
    customer.preferredCategories = top;
  }
}

// Note: ABC recompute (Pareto + per-order P&L) lives in
// lib/financeiro/recompute.ts. We invoke it from here as a side-job of
// the RFM cron so we don't add a second cron — but the implementation
// is owned by the financeiro module, not CRM.
