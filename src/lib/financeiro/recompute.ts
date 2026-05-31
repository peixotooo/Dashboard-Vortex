// src/lib/financeiro/recompute.ts
//
// Orchestration: pulls crm_vendas + product_costs + financial_settings
// for a workspace, runs computeAbcAndProfitability, and upserts the
// snapshot in crm_abc_snapshots.
//
// Called from the existing crm-recompute cron (which also drives RFM)
// so we don't add new infrastructure — just one extra concern in the
// same job. Best-effort: if anything in here throws, the parent
// recompute logs and continues so RFM still gets refreshed.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmVendaRow } from "@/lib/crm-rfm";
import {
  computeAbcAndProfitability,
  type FinancialSettings,
} from "./abc";

/** Default lookback the snapshot covers (30d). A janela é editável na
 *  UI — passar period_days pra recomputeAbcSnapshot pra alterar.
 *  Mantemos 30d como default porque é a janela mais útil pra decisão
 *  comercial (mais curto que os 90d do bestseller_lookback) e evita
 *  arrastar produtos antigos que pararam de vender. */
export const ABC_PERIOD_DAYS_DEFAULT = 30;
export const ABC_ALLOWED_PERIODS = [7, 14, 30, 60, 90] as const;
export type AbcPeriodDays = (typeof ABC_ALLOWED_PERIODS)[number];

/** @deprecated use ABC_PERIOD_DAYS_DEFAULT */
export const ABC_PERIOD_DAYS = ABC_PERIOD_DAYS_DEFAULT;

/** Defaults mirror /api/financial-settings/route.ts so a workspace
 *  with no row in workspace_financial_settings still gets sensible
 *  numbers (Bulking baseline). */
const FINANCIAL_DEFAULTS: FinancialSettings = {
  product_cost_pct: 25,
  tax_pct: 6,
  other_expenses_pct: 5,
  custo_frete_medio_brl: 18, // ballpark BRL/order Bulking
};

function parseOrderDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function recomputeAbcSnapshot(
  client: SupabaseClient,
  workspaceId: string,
  allRows: CrmVendaRow[],
  periodDays: number = ABC_PERIOD_DAYS_DEFAULT
): Promise<void> {
  // 1. Filter to the analysis window.
  const cutoffTs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const recentRows = allRows.filter((row) => {
    const purchasedAt = parseOrderDate(row.data_compra);
    return purchasedAt ? purchasedAt.getTime() >= cutoffTs : false;
  });

  // 2. Load product costs (workspace-scoped).
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
      `[financeiro/recompute] product_costs load failed for ${workspaceId}:`,
      (err as Error).message
    );
  }

  // 3. Load financial settings (the same row that backs the commercial
  // simulator). Falls back to defaults if the workspace hasn't filled
  // them in yet — better than blocking the whole snapshot on missing
  // config.
  let financial = FINANCIAL_DEFAULTS;
  try {
    const { data } = await client
      .from("workspace_financial_settings")
      .select("product_cost_pct, tax_pct, other_expenses_pct, custo_frete_medio_brl")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data) {
      financial = {
        product_cost_pct:
          typeof (data as { product_cost_pct?: number }).product_cost_pct === "number"
            ? (data as { product_cost_pct: number }).product_cost_pct
            : FINANCIAL_DEFAULTS.product_cost_pct,
        tax_pct:
          typeof (data as { tax_pct?: number }).tax_pct === "number"
            ? (data as { tax_pct: number }).tax_pct
            : FINANCIAL_DEFAULTS.tax_pct,
        other_expenses_pct:
          typeof (data as { other_expenses_pct?: number }).other_expenses_pct === "number"
            ? (data as { other_expenses_pct: number }).other_expenses_pct
            : FINANCIAL_DEFAULTS.other_expenses_pct,
        custo_frete_medio_brl:
          typeof (data as { custo_frete_medio_brl?: number }).custo_frete_medio_brl === "number"
            ? (data as { custo_frete_medio_brl: number }).custo_frete_medio_brl
            : FINANCIAL_DEFAULTS.custo_frete_medio_brl,
      };
    }
  } catch {
    /* keep defaults */
  }

  // 4. Compute and persist.
  const result = computeAbcAndProfitability(recentRows, costsBySku, financial);

  const { error } = await client
    .from("crm_abc_snapshots")
    .upsert(
      {
        workspace_id: workspaceId,
        period_days: periodDays,
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
