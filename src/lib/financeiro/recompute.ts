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
  type AbcProductRow,
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

type StockSource = "hub_products" | "pricing_history";

type ProductStockEntry = {
  units: number;
  source: StockSource;
};

const DB_PAGE_SIZE = 1000;

function parseOrderDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeSku(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function baseSkuOf(value: string | null | undefined): string {
  return normalizeSku(value).replace(/-\d+$/, "");
}

function stockUnits(value: unknown, fallback?: unknown): number {
  const primary = Number(value);
  if (Number.isFinite(primary)) return Math.max(0, Math.round(primary));
  const secondary = Number(fallback);
  if (Number.isFinite(secondary)) return Math.max(0, Math.round(secondary));
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function productStockKeys(product: AbcProductRow): string[] {
  const keys = new Set<string>();
  for (const value of [product.sku, product.product_id]) {
    const exact = normalizeSku(value);
    const base = baseSkuOf(value);
    if (exact) keys.add(exact);
    if (base) keys.add(base);
  }
  return [...keys];
}

function enrichProductsWithTurnover(
  products: AbcProductRow[],
  stockBySku: Map<string, ProductStockEntry>,
  periodDays: number
): AbcProductRow[] {
  const days = Math.max(1, periodDays);

  return products.map((product) => {
    const stock = productStockKeys(product)
      .map((key) => stockBySku.get(key))
      .find((entry): entry is ProductStockEntry => Boolean(entry));

    const unitsPerDay = product.qty_sold / days;
    const stockValue = stock?.units ?? null;
    const coverage =
      stockValue == null
        ? null
        : unitsPerDay > 0
          ? stockValue / unitsPerDay
          : null;
    const turnover =
      stockValue != null && stockValue > 0 ? product.qty_sold / stockValue : null;

    return {
      ...product,
      units_per_day: round4(unitsPerDay),
      stock_units: stockValue,
      stock_coverage_days: coverage == null ? null : round2(coverage),
      turnover_period: turnover == null ? null : round4(turnover),
      stock_source: stock?.source ?? "none",
    };
  });
}

async function mergeHubProductStock(
  client: SupabaseClient,
  workspaceId: string,
  target: Map<string, ProductStockEntry>
): Promise<void> {
  type HubStockRow = {
    sku: string | null;
    ecc_pai_sku: string | null;
    estoque: number | string | null;
    ml_estoque: number | string | null;
  };
  type StockGroup = {
    parentStock: number | null;
    childStock: number;
    childCount: number;
    looseVariantStock: number;
  };

  const groups = new Map<string, StockGroup>();
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("hub_products")
      .select("sku, ecc_pai_sku, estoque, ml_estoque")
      .eq("workspace_id", workspaceId)
      .range(from, from + DB_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as HubStockRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sku = normalizeSku(row.sku);
      const parentSku = normalizeSku(row.ecc_pai_sku);
      const baseSku = baseSkuOf(sku);
      const groupKey = parentSku || baseSku || sku;
      if (!groupKey) continue;

      const group =
        groups.get(groupKey) ??
        { parentStock: null, childStock: 0, childCount: 0, looseVariantStock: 0 };
      const units = stockUnits(row.estoque, row.ml_estoque);

      if (parentSku) {
        group.childStock += units;
        group.childCount += 1;
      } else if (sku && baseSku && sku !== baseSku) {
        group.looseVariantStock += units;
      } else {
        group.parentStock = Math.max(group.parentStock ?? 0, units);
      }

      groups.set(groupKey, group);
    }

    if (rows.length < DB_PAGE_SIZE) break;
    from += DB_PAGE_SIZE;
  }

  for (const [sku, group] of groups) {
    const units =
      group.childCount > 0
        ? group.childStock
        : group.looseVariantStock > 0
          ? group.looseVariantStock
          : group.parentStock;

    if (units != null) {
      target.set(sku, { units, source: "hub_products" });
    }
  }
}

async function mergeLatestPricingStock(
  client: SupabaseClient,
  workspaceId: string,
  target: Map<string, ProductStockEntry>
): Promise<void> {
  type PricingStockRow = {
    sku: string | null;
    stock_units: number | string | null;
    snapshot_date: string | null;
  };
  type StockGroup = {
    parentStock: number | null;
    variantStock: number;
  };

  const { data: latest, error: latestError } = await client
    .from("sku_pricing_history")
    .select("snapshot_date")
    .eq("workspace_id", workspaceId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot_date: string | null }>();

  if (latestError) throw new Error(latestError.message);
  if (!latest?.snapshot_date) return;

  const stockByExactSku = new Map<string, number>();
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("sku_pricing_history")
      .select("sku, stock_units, snapshot_date")
      .eq("workspace_id", workspaceId)
      .eq("snapshot_date", latest.snapshot_date)
      .range(from, from + DB_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PricingStockRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const sku = normalizeSku(row.sku);
      if (!sku) continue;
      const units = stockUnits(row.stock_units);
      stockByExactSku.set(sku, Math.max(stockByExactSku.get(sku) ?? 0, units));
    }

    if (rows.length < DB_PAGE_SIZE) break;
    from += DB_PAGE_SIZE;
  }

  const groups = new Map<string, StockGroup>();
  for (const [sku, units] of stockByExactSku) {
    const baseSku = baseSkuOf(sku) || sku;
    const group = groups.get(baseSku) ?? { parentStock: null, variantStock: 0 };
    if (sku !== baseSku) group.variantStock += units;
    else group.parentStock = Math.max(group.parentStock ?? 0, units);
    groups.set(baseSku, group);
  }

  for (const [sku, group] of groups) {
    if (target.has(sku)) continue;
    const units = group.variantStock > 0 ? group.variantStock : group.parentStock;
    if (units != null) {
      target.set(sku, { units, source: "pricing_history" });
    }
  }
}

async function loadStockBySku(
  client: SupabaseClient,
  workspaceId: string
): Promise<Map<string, ProductStockEntry>> {
  const stockBySku = new Map<string, ProductStockEntry>();

  try {
    await mergeHubProductStock(client, workspaceId, stockBySku);
  } catch (err) {
    console.warn(
      `[financeiro/recompute] hub_products stock load failed for ${workspaceId}:`,
      (err as Error).message
    );
  }

  try {
    await mergeLatestPricingStock(client, workspaceId, stockBySku);
  } catch (err) {
    console.warn(
      `[financeiro/recompute] pricing stock fallback failed for ${workspaceId}:`,
      (err as Error).message
    );
  }

  return stockBySku;
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

  // 4. Compute, enrich with inventory turnover, and persist.
  const result = computeAbcAndProfitability(recentRows, costsBySku, financial);
  const stockBySku = await loadStockBySku(client, workspaceId);
  const products = enrichProductsWithTurnover(
    result.products,
    stockBySku,
    periodDays
  );

  const { error } = await client
    .from("crm_abc_snapshots")
    .upsert(
      {
        workspace_id: workspaceId,
        period_days: periodDays,
        products,
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
