import { generateRfmReport, generateMonthlyCohort } from "@/lib/crm-rfm";
import type { CrmVendaRow, RfmCustomer, PreferenceCount } from "@/lib/crm-rfm";
import { computeAbcAndProfitability } from "@/lib/crm-abc";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000; // Supabase default max rows per request

/** Window the ABC curve is computed over. Matches Frente B's
 *  bestseller_lookback_days default — "real bestseller" and "ABC class
 *  A" should agree on what counts as "recent enough". */
const ABC_PERIOD_DAYS = 90;

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
        // Columns split across two consumers:
        //   - RFM aggregator uses cliente/email/.../items
        //   - ABC compute also needs payment_method, installments,
        //     shipping_price, discount_price, source_order_id pra
        //     calcular lucratividade por order
        "cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores, items, payment_method, installments, shipping_price, discount_price, source_order_id"
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

/**
 * Loads workspace cost data + ABC settings, runs the Pareto
 * classification + per-order profitability over the last
 * ABC_PERIOD_DAYS of crm_vendas, and upserts the result into
 * crm_abc_snapshots.
 *
 * Failures here don't break the parent recompute — RFM is the primary
 * use case and ABC is a secondary report that can recover on the next
 * run.
 */
async function recomputeAbcSnapshot(
  client: SupabaseClient,
  workspaceId: string,
  allRows: CrmVendaRow[]
): Promise<void> {
  // Filter rows to the ABC window. data_compra is ISO-ish; lexicographic
  // compare works for "YYYY-MM-DD..." strings.
  const cutoff = new Date(Date.now() - ABC_PERIOD_DAYS * 24 * 60 * 60 * 1000)
    .toISOString();
  const recentRows = allRows.filter(
    (r) => r.data_compra && r.data_compra >= cutoff
  );

  // Load product costs (workspace-scoped).
  const costsBySku = new Map<string, number>();
  try {
    const { data } = await client
      .from("product_costs")
      .select("sku, cost")
      .eq("workspace_id", workspaceId);
    for (const row of (data ?? []) as Array<{ sku: string; cost: number }>) {
      const k = row.sku.trim().toLowerCase();
      if (k) costsBySku.set(k, Number(row.cost));
    }
  } catch (err) {
    console.warn(
      `[crm-compute] product_costs load failed for ${workspaceId}:`,
      (err as Error).message
    );
  }

  // Load default margin from email_template_settings. Falls back to
  // 0.5 (50%) if unset or the table doesn't exist yet.
  let defaultMarginPct = 0.5;
  try {
    const { data } = await client
      .from("email_template_settings")
      .select("default_margin_pct")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data && typeof (data as { default_margin_pct?: number }).default_margin_pct === "number") {
      defaultMarginPct = (data as { default_margin_pct: number }).default_margin_pct;
    }
  } catch {
    /* keep default */
  }

  const result = computeAbcAndProfitability(recentRows, costsBySku, {
    defaultMarginPct,
  });

  const { error } = await client
    .from("crm_abc_snapshots")
    .upsert(
      {
        workspace_id: workspaceId,
        period_days: ABC_PERIOD_DAYS,
        products: result.products,
        orders: result.orders,
        summary: result.summary,
        row_count: recentRows.length,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

  if (error) {
    throw new Error(`ABC snapshot upsert error: ${error.message}`);
  }
}
