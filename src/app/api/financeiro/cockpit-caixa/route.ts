import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, getAuthenticatedContext, handleAuthError, resolveTokenForAccount } from "@/lib/api-auth";
import { getInsights, setContextToken } from "@/lib/meta-api";
import { getGA4DailyReport, getGA4GoogleAdsCost } from "@/lib/ga4-api";
import { getVndaConfig, getVndaDailyReport } from "@/lib/vnda-api";
import { FIN_DEFAULTS, type FinancialSettingsShape } from "@/lib/financeiro/defaults";
import { coverageReliability, inventoryCoverageDays } from "@/lib/financeiro/metrics";

export const maxDuration = 120;

const TZ = "America/Sao_Paulo";

// Janela do snapshot ABC (crm_abc_snapshots roda 90d rolling). Usada para
// estimar o run-rate diário de venda por SKU ao calcular cobertura de estoque.
const ABC_WINDOW_DAYS = 90;
// Abaixo de quantos dias de cobertura um campeão é considerado "em risco
// de ruptura" — escalar ads nele empurra tráfego pra falta de estoque.
const LOW_COVERAGE_DAYS = 12;

// Defaults centralizados (ver src/lib/financeiro/defaults.ts) — não
// redeclarar números mágicos aqui.
const DEFAULT_SETTINGS: FinancialSettingsShape = FIN_DEFAULTS;

type Settings = FinancialSettingsShape;

type BaseDaily = {
  date: string;
  revenue: number;
  orders: number;
  subtotal: number;
  discount: number;
  shipping: number;
};

type DailyRow = {
  date: string;
  label: string;
  revenue: number;
  orders: number;
  ads: number;
  meta_spend: number;
  google_spend: number;
  /** Caixa de contribuição = receita − custos variáveis (CMV+imposto+
   *  frete+outras) − ads. É CM2: o dinheiro que SOBRA da operação, não
   *  o antigo "receita − ads" que ignorava ~36% de custos. */
  cash: number;
  /** Custos variáveis estimados do dia (CMV+imposto+frete+outras). */
  variable_costs: number;
  /** Receita − ads (a definição ANTIGA de caixa), mantida só para
   *  transparência/comparação. NÃO usar para decisão. */
  gross_cash: number;
  sessions: number;
  conversion_rate: number;
  avg_ticket: number;
  mer: number | null;
  source: "vnda" | "crm" | "ga4" | "none";
  is_today: boolean;
};

type PatternRow = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  avg_ticket: number;
};

type BehaviorPatterns = {
  window_days: number;
  orders: number;
  confidence: "alta" | "media" | "baixa";
  best_week: PatternRow | null;
  worst_week: PatternRow | null;
  best_weekday: PatternRow | null;
  worst_weekday: PatternRow | null;
  best_hour: PatternRow | null;
  worst_hour: PatternRow | null;
  best_combos: PatternRow[];
};

type ProductSignal = {
  sku: string;
  name: string;
  revenue: number;
  qty_sold: number;
  margin_pct: number;
  abc_class: string;
  in_stock: boolean | null;
  active: boolean | null;
  price: number | null;
  sale_price: number | null;
  category: string | null;
  /** Unidades em estoque (hub_products.estoque, somado pelas variantes do
   *  SKU pai). null quando o workspace não tem hub populado. */
  stock_units: number | null;
  /** Cobertura em dias = estoque ÷ venda diária (run-rate ABC 90d).
   *  null = sem run-rate; Infinity = estoque sem venda. */
  coverage_days: number | null;
};

type OperationalContext = {
  abc_computed_at: string | null;
  abc_coverage_pct: number | null;
  /** Confiabilidade da margem dada a cobertura de custo: alta/media/baixa. */
  margin_reliability: "alta" | "media" | "baixa" | null;
  top_a_count: number;
  a_revenue_share_pct: number;
  top_a_ready: ProductSignal[];
  top_a_out_of_stock: ProductSignal[];
  top_a_low_margin: ProductSignal[];
  top_a_discounted: ProductSignal[];
  /** Campeões A com cobertura de estoque baixa (risco de ruptura ao escalar). */
  top_a_low_coverage: ProductSignal[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function brl(value: number): string {
  return round2(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    ymd: `${byType.year}-${byType.month}-${byType.day}`,
  };
}

function ymdInBr(value: string | Date): string {
  return brDateParts(typeof value === "string" ? new Date(value) : value).ymd;
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function labelDate(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

function yyyymmddToYmd(raw: string): string {
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}

function weekdayIndex(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function weekdayLabel(ymd: string): string {
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][weekdayIndex(ymd)] || "";
}

function hourBand(date: Date): string {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).format(date));
  if (hour < 6) return "Madrugada";
  if (hour < 12) return "Manha";
  if (hour < 18) return "Tarde";
  return "Noite";
}

function weekOfMonth(ymd: string): number {
  return Math.min(5, Math.ceil(Number(ymd.slice(8, 10)) / 7));
}

function mergeSettings(raw: Record<string, unknown> | null): Settings {
  const seasonality = Array.isArray(raw?.monthly_seasonality)
    ? raw.monthly_seasonality.map((v) => toNumber(v))
    : DEFAULT_SETTINGS.monthly_seasonality;
  return {
    monthly_fixed_costs: toNumber(raw?.monthly_fixed_costs, DEFAULT_SETTINGS.monthly_fixed_costs),
    tax_pct: toNumber(raw?.tax_pct, DEFAULT_SETTINGS.tax_pct),
    product_cost_pct: toNumber(raw?.product_cost_pct, DEFAULT_SETTINGS.product_cost_pct),
    other_expenses_pct: toNumber(raw?.other_expenses_pct, DEFAULT_SETTINGS.other_expenses_pct),
    monthly_seasonality: seasonality.length === 12 ? seasonality : DEFAULT_SETTINGS.monthly_seasonality,
    target_profit_monthly: toNumber(raw?.target_profit_monthly, DEFAULT_SETTINGS.target_profit_monthly),
    safety_margin_pct: toNumber(raw?.safety_margin_pct, DEFAULT_SETTINGS.safety_margin_pct),
    annual_revenue_target: toNumber(raw?.annual_revenue_target, DEFAULT_SETTINGS.annual_revenue_target),
    invest_pct: toNumber(raw?.invest_pct, DEFAULT_SETTINGS.invest_pct),
    frete_pct: toNumber(raw?.frete_pct, DEFAULT_SETTINGS.frete_pct),
    desconto_pct: toNumber(raw?.desconto_pct, DEFAULT_SETTINGS.desconto_pct),
    daily_cash_floor_brl: toNumber(raw?.daily_cash_floor_brl, DEFAULT_SETTINGS.daily_cash_floor_brl),
    custo_frete_medio_brl: toNumber(raw?.custo_frete_medio_brl, DEFAULT_SETTINGS.custo_frete_medio_brl),
  };
}

async function fetchPaged<T>(
  buildQuery: () => any,
  opts: { pageSize?: number; hardCap?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const hardCap = opts.hardCap ?? 100000;
  const out: T[] = [];

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function fetchCrmRevenue(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  start: string,
  end: string
): Promise<{ rows: Map<string, BaseDaily>; hasData: boolean }> {
  const sales = await fetchPaged<{ data_compra: string | null; valor: number | null }>(() =>
    admin
      .from("crm_vendas")
      .select("data_compra, valor")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", `${start}T00:00:00.000Z`)
      .lte("data_compra", `${end}T23:59:59.999Z`)
  );

  const rows = new Map<string, BaseDaily>();
  for (const sale of sales) {
    if (!sale.data_compra) continue;
    const date = ymdInBr(sale.data_compra);
    const current = rows.get(date) || {
      date,
      revenue: 0,
      orders: 0,
      subtotal: 0,
      discount: 0,
      shipping: 0,
    };
    current.revenue += toNumber(sale.valor);
    current.orders += 1;
    rows.set(date, current);
  }

  return { rows, hasData: rows.size > 0 };
}

async function fetchRevenue(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  start: string,
  end: string
): Promise<{ rows: Map<string, BaseDaily>; source: DailyRow["source"]; configured: Record<string, boolean> }> {
  const crm = await fetchCrmRevenue(admin, workspaceId, start, end);

  try {
    const config = await getVndaConfig(workspaceId);
    if (config) {
      const report = await getVndaDailyReport({ config, startDate: start, endDate: end });
      const rows = new Map<string, BaseDaily>();
      for (const row of report.insights || []) {
        rows.set(row.dateRaw, {
          date: row.dateRaw,
          revenue: toNumber(row.revenue),
          orders: toNumber(row.orders),
          subtotal: toNumber(row.subtotal),
          discount: toNumber(row.discount),
          shipping: toNumber(row.shipping),
        });
      }
      if (rows.size > 0) {
        return { rows, source: "vnda", configured: { vnda: true, ga4: Boolean(process.env.GA4_PROPERTY_ID), crm: crm.hasData } };
      }
    }
  } catch (err) {
    console.error("[Cockpit Caixa] VNDA revenue failed:", err instanceof Error ? err.message : err);
  }

  if (crm.hasData) {
    return { rows: crm.rows, source: "crm", configured: { vnda: false, ga4: Boolean(process.env.GA4_PROPERTY_ID), crm: true } };
  }

  try {
    if (process.env.GA4_PROPERTY_ID) {
      const report = await getGA4DailyReport({ startDate: start, endDate: end });
      const rows = new Map<string, BaseDaily>();
      for (const row of report.insights || []) {
        rows.set(yyyymmddToYmd(row.dateRaw), {
          date: yyyymmddToYmd(row.dateRaw),
          revenue: toNumber(row.revenue),
          orders: toNumber(row.transactions),
          subtotal: 0,
          discount: 0,
          shipping: 0,
        });
      }
      return { rows, source: rows.size > 0 ? "ga4" : "none", configured: { vnda: false, ga4: true, crm: false } };
    }
  } catch (err) {
    console.error("[Cockpit Caixa] GA4 revenue fallback failed:", err instanceof Error ? err.message : err);
  }

  return { rows: new Map(), source: "none", configured: { vnda: false, ga4: Boolean(process.env.GA4_PROPERTY_ID), crm: false } };
}

async function fetchMetaDailySpend(
  request: NextRequest,
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  start: string,
  end: string
): Promise<Map<string, { spend: number; clicks: number; impressions: number }>> {
  const out = new Map<string, { spend: number; clicks: number; impressions: number }>();

  try {
    await getAuthenticatedContext(request);
  } catch (err) {
    console.warn("[Cockpit Caixa] Meta auth unavailable:", err instanceof Error ? err.message : err);
    return out;
  }

  const { data: accounts } = await admin
    .from("meta_accounts")
    .select("account_id")
    .eq("workspace_id", workspaceId) as unknown as { data: Array<{ account_id: string }> | null };

  for (const account of accounts || []) {
    try {
      const _tok = await resolveTokenForAccount(workspaceId, account.account_id);
      if (_tok) setContextToken(_tok);
      const result = await getInsights({
        object_id: account.account_id,
        level: "account",
        time_range: { since: start, until: end },
        time_increment: "1",
        fields: ["spend", "clicks", "impressions"],
      }) as { insights?: Array<{ date_start?: string; spend?: string; clicks?: string; impressions?: string }> };

      for (const row of result.insights || []) {
        if (!row.date_start) continue;
        const current = out.get(row.date_start) || { spend: 0, clicks: 0, impressions: 0 };
        current.spend += toNumber(row.spend);
        current.clicks += toNumber(row.clicks);
        current.impressions += toNumber(row.impressions);
        out.set(row.date_start, current);
      }
    } catch (err) {
      console.error("[Cockpit Caixa] Meta spend failed:", err instanceof Error ? err.message : err);
    }
  }

  return out;
}

async function fetchGoogleDailySpend(start: string, end: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    if (!process.env.GA4_PROPERTY_ID) return out;
    const report = await getGA4GoogleAdsCost({ startDate: start, endDate: end }).catch(() => null);
    for (const row of report?.daily || []) {
      out.set(yyyymmddToYmd(row.dateRaw), toNumber(row.cost));
    }
  } catch (err) {
    console.error("[Cockpit Caixa] Google spend failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

function buildDailyRows(args: {
  dates: string[];
  revenueRows: Map<string, BaseDaily>;
  revenueSource: DailyRow["source"];
  metaSpend: Map<string, { spend: number; clicks: number; impressions: number }>;
  googleSpend: Map<string, number>;
  ga4Rows: Map<string, { sessions: number; transactions: number }>;
  today: string;
  settings: Settings;
}): DailyRow[] {
  // Custos variáveis como fração da receita. NÃO incluímos desconto aqui
  // porque a receita do crm_vendas já vem líquida de desconto — somar de
  // novo contaria duas vezes.
  const varCostFrac = Math.max(
    0,
    Math.min(
      1,
      (args.settings.product_cost_pct +
        args.settings.tax_pct +
        args.settings.other_expenses_pct +
        args.settings.frete_pct) /
        100
    )
  );

  return args.dates.map((date) => {
    const revenue = args.revenueRows.get(date);
    const meta = args.metaSpend.get(date);
    const metaSpend = toNumber(meta?.spend);
    const googleSpend = toNumber(args.googleSpend.get(date));
    const ads = metaSpend + googleSpend;
    const ga4 = args.ga4Rows.get(date);
    const orders = toNumber(revenue?.orders) || toNumber(ga4?.transactions);
    const sessions = toNumber(ga4?.sessions);
    const revenueValue = toNumber(revenue?.revenue);

    // Caixa de contribuição (CM2): receita − custos variáveis − ads.
    // Substitui o antigo `receita − ads`, que mostrava caixa onde não havia.
    const variableCosts = revenueValue * varCostFrac;
    const contribution = revenueValue - variableCosts - ads;

    return {
      date,
      label: labelDate(date),
      revenue: round2(revenueValue),
      orders,
      ads: round2(ads),
      meta_spend: round2(metaSpend),
      google_spend: round2(googleSpend),
      cash: round2(contribution),
      variable_costs: round2(variableCosts),
      gross_cash: round2(revenueValue - ads),
      sessions,
      conversion_rate: sessions > 0 ? round2((orders / sessions) * 100) : 0,
      avg_ticket: orders > 0 ? round2(revenueValue / orders) : 0,
      // MER blended honesto: receita REAL (fonte preferida VNDA) / spend total.
      mer: ads > 0 ? round2(revenueValue / ads) : null,
      source: revenueValue > 0 ? args.revenueSource : "none",
      is_today: date === args.today,
    };
  });
}

function sumRows(rows: DailyRow[]) {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const ads = rows.reduce((sum, row) => sum + row.ads, 0);
  const cash = rows.reduce((sum, row) => sum + row.cash, 0);
  const variableCosts = rows.reduce((sum, row) => sum + row.variable_costs, 0);
  const grossCash = rows.reduce((sum, row) => sum + row.gross_cash, 0);
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  return {
    revenue: round2(revenue),
    ads: round2(ads),
    cash: round2(cash),
    variable_costs: round2(variableCosts),
    gross_cash: round2(grossCash),
    orders,
    sessions,
    avg_ticket: orders > 0 ? round2(revenue / orders) : 0,
    conversion_rate: sessions > 0 ? round2((orders / sessions) * 100) : 0,
    mer: ads > 0 ? round2(revenue / ads) : null,
  };
}

function avgRows(rows: DailyRow[]) {
  const totals = sumRows(rows);
  const days = Math.max(1, rows.length);
  return {
    revenue: round2(totals.revenue / days),
    ads: round2(totals.ads / days),
    cash: round2(totals.cash / days),
    variable_costs: round2(totals.variable_costs / days),
    gross_cash: round2(totals.gross_cash / days),
    orders: round2(totals.orders / days),
    sessions: round2(totals.sessions / days),
    avg_ticket: totals.avg_ticket,
    conversion_rate: totals.conversion_rate,
    mer: totals.mer,
  };
}

function gapPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return round2(((actual - target) / target) * 100);
}

function factorStatus(gap: number): "ok" | "warning" | "critical" {
  if (gap >= 0) return "ok";
  if (gap >= -15) return "warning";
  return "critical";
}

function normalizeMarginPct(value: unknown): number {
  const raw = toNumber(value);
  return raw <= 1 ? raw * 100 : raw;
}

function productNames(rows: ProductSignal[], limit = 3): string {
  return rows.slice(0, limit).map((row) => row.name || row.sku).join("; ");
}

function emptyOperationalContext(): OperationalContext {
  return {
    abc_computed_at: null,
    abc_coverage_pct: null,
    margin_reliability: null,
    top_a_count: 0,
    a_revenue_share_pct: 0,
    top_a_ready: [],
    top_a_out_of_stock: [],
    top_a_low_margin: [],
    top_a_discounted: [],
    top_a_low_coverage: [],
  };
}

/** Soma o estoque (hub_products.estoque) por SKU pai. As variantes vêm com
 *  sufixo "-NNNN"; agrupamos pelo prefixo para casar com a curva ABC, que
 *  agrega no nível do pai. Best-effort: se o hub não estiver populado para
 *  o workspace, retorna mapa vazio e a cobertura fica indisponível. */
async function fetchStockByParentSku(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await fetchPaged<{ sku: string | null; estoque: number | null }>(() =>
      admin.from("hub_products").select("sku, estoque").eq("workspace_id", workspaceId)
    );
    for (const row of rows) {
      const sku = String(row.sku || "").trim();
      if (!sku) continue;
      const parent = sku.replace(/-\d{1,5}$/, "");
      out.set(parent, (out.get(parent) || 0) + Math.max(0, toNumber(row.estoque)));
    }
  } catch (err) {
    console.error(
      "[Cockpit Caixa] Stock coverage unavailable:",
      err instanceof Error ? err.message : err
    );
  }
  return out;
}

async function fetchOperationalContext(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<OperationalContext> {
  try {
    const { data, error } = await admin
      .from("crm_abc_snapshots")
      .select("summary, products, computed_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle<{
        summary: Record<string, unknown> | null;
        products: Array<Record<string, unknown>> | null;
        computed_at: string | null;
      }>();

    if (error || !data?.products?.length) return emptyOperationalContext();

    const products = data.products;
    const topA = products
      .filter((product) => String(product.abc_class || "").toUpperCase() === "A")
      .sort((a, b) => toNumber(b.revenue) - toNumber(a.revenue))
      .slice(0, 60);
    const skus = [...new Set(topA.map((product) => String(product.sku || "")).filter(Boolean))];

    const catalogBySku = new Map<string, {
      sku: string | null;
      product_id: string | null;
      name: string | null;
      in_stock: boolean | null;
      active: boolean | null;
      price: number | null;
      sale_price: number | null;
      category: string | null;
    }>();

    if (skus.length > 0) {
      const { data: catalog } = await admin
        .from("shelf_products")
        .select("sku, product_id, name, in_stock, active, price, sale_price, category")
        .eq("workspace_id", workspaceId)
        .in("sku", skus) as unknown as {
          data: Array<{
            sku: string | null;
            product_id: string | null;
            name: string | null;
            in_stock: boolean | null;
            active: boolean | null;
            price: number | null;
            sale_price: number | null;
            category: string | null;
          }> | null;
        };

      for (const item of catalog || []) {
        if (item.sku) catalogBySku.set(item.sku, item);
      }
    }

    const stockByParent = await fetchStockByParentSku(admin, workspaceId);

    const signals: ProductSignal[] = topA.map((product) => {
      const sku = String(product.sku || "");
      const catalog = catalogBySku.get(sku);
      const parentSku = sku.replace(/-\d{1,5}$/, "");
      const stockUnits = stockByParent.has(parentSku) ? stockByParent.get(parentSku)! : null;
      const qtySold = toNumber(product.qty_sold);
      const dailyRunRate = qtySold / ABC_WINDOW_DAYS;
      const coverageDays =
        stockUnits == null ? null : inventoryCoverageDays(stockUnits, dailyRunRate);
      return {
        sku,
        name: String(catalog?.name || product.name || sku || "Produto"),
        revenue: round2(toNumber(product.revenue)),
        qty_sold: qtySold,
        margin_pct: round2(normalizeMarginPct(product.margin_pct)),
        abc_class: String(product.abc_class || "A"),
        in_stock: catalog?.in_stock ?? null,
        active: catalog?.active ?? null,
        price: catalog?.price ?? null,
        sale_price: catalog?.sale_price ?? null,
        category: catalog?.category ?? null,
        stock_units: stockUnits,
        coverage_days:
          coverageDays == null ? null : Number.isFinite(coverageDays) ? round2(coverageDays) : coverageDays,
      };
    });

    const totalRevenue = toNumber(data.summary?.total_revenue);
    const aRevenue = topA.reduce((sum, product) => sum + toNumber(product.revenue), 0);
    const coveragePct = data.summary?.coverage_pct == null ? null : toNumber(data.summary.coverage_pct);

    return {
      abc_computed_at: data.computed_at,
      abc_coverage_pct: coveragePct == null ? null : round2(coveragePct),
      margin_reliability: coveragePct == null ? null : coverageReliability(coveragePct),
      top_a_count: signals.length,
      a_revenue_share_pct: totalRevenue > 0 ? round2((aRevenue / totalRevenue) * 100) : 0,
      top_a_ready: signals.filter((product) => product.in_stock !== false && product.active !== false && product.margin_pct >= 45 && (product.coverage_days == null || product.coverage_days >= LOW_COVERAGE_DAYS)),
      top_a_out_of_stock: signals.filter((product) => product.in_stock === false || product.active === false).slice(0, 8),
      top_a_low_margin: signals.filter((product) => product.margin_pct > 0 && product.margin_pct < 45).slice(0, 8),
      top_a_discounted: signals.filter((product) => product.price != null && product.sale_price != null && product.sale_price < product.price).slice(0, 8),
      top_a_low_coverage: signals.filter((product) => product.coverage_days != null && Number.isFinite(product.coverage_days) && product.coverage_days < LOW_COVERAGE_DAYS).slice(0, 8),
    };
  } catch (err) {
    console.error("[Cockpit Caixa] Operational context failed:", err instanceof Error ? err.message : err);
    return emptyOperationalContext();
  }
}

function buildDiagnosis(args: {
  dailyFloor: number;
  monthTarget: number;
  daysInMonth: number;
  currentDay: number;
  rows: DailyRow[];
  completedRows: DailyRow[];
  patterns: BehaviorPatterns;
  operational: OperationalContext;
}) {
  const totals = sumRows(args.rows);
  const basis = args.completedRows.length > 0 ? args.completedRows : args.rows;
  const avg = avgRows(basis);
  const recentRows = basis.slice(-7);
  const previousRows = basis.slice(Math.max(0, basis.length - 14), Math.max(0, basis.length - 7));
  const recentAvg = avgRows(recentRows.length > 0 ? recentRows : basis);
  const previousAvg = avgRows(previousRows.length > 0 ? previousRows : recentRows.length > 0 ? recentRows : basis);
  const remainingDays = Math.max(1, args.daysInMonth - args.currentDay + 1);
  const monthlyCashTarget = args.dailyFloor * args.daysInMonth;
  const elapsedCashTarget = monthlyCashTarget * (args.currentDay / args.daysInMonth);
  const seasonalGap = Math.max(0, args.monthTarget - totals.revenue);
  const cashGap = Math.max(0, monthlyCashTarget - totals.cash);
  const requiredRevenueDaily = round2(seasonalGap / remainingDays);
  const requiredCashDaily = round2(cashGap / remainingDays);
  const requiredRevenueFromCash = requiredCashDaily + avg.ads;
  const revenueNeeded = Math.max(requiredRevenueDaily, requiredRevenueFromCash, avg.revenue);
  const ordersNeeded = avg.avg_ticket > 0 ? revenueNeeded / avg.avg_ticket : 0;
  const conversionNeeded = avg.sessions > 0 && avg.avg_ticket > 0
    ? (ordersNeeded / avg.sessions) * 100
    : 0;
  const ticketNeeded = avg.orders > 0 ? revenueNeeded / avg.orders : 0;
  const adsCeiling = Math.max(0, avg.revenue - args.dailyFloor);
  const merNeeded = avg.ads > 0 ? revenueNeeded / avg.ads : null;
  const adsShare = avg.revenue > 0 ? avg.ads / avg.revenue : 0;
  const conversionDropOnScale =
    previousRows.length >= 3 &&
    recentAvg.ads > previousAvg.ads * 1.1 &&
    recentAvg.conversion_rate > 0 &&
    previousAvg.conversion_rate > 0 &&
    recentAvg.conversion_rate < previousAvg.conversion_rate * 0.92;
  const conversionWeak = conversionNeeded > 0 && avg.conversion_rate < conversionNeeded * 0.9;
  const ticketWeak = ticketNeeded > 0 && avg.avg_ticket < ticketNeeded * 0.9;
  // Estoque trava a escala se há campeão fora de estoque OU com cobertura
  // baixa de dias (escalar ads num SKU que rompe em 48h queima budget).
  const inventoryBlocked =
    args.operational.top_a_out_of_stock.length > 0 ||
    args.operational.top_a_low_coverage.length > 0;
  const marginPressure = args.operational.top_a_low_margin.length > 0 || adsShare > 0.18;
  const merActual = avg.mer ?? 0;
  const merTarget = merNeeded ?? (avg.ads > 0 ? Math.max(merActual, 1) : 0);
  // Tendência recente de caixa (últimos 7 dias) — não só o acumulado do mês.
  // Evita liberar escala no fim do mês quando o MTD está ok por acaso mas a
  // dinâmica diária já virou negativa.
  const isCashTrendOk = recentRows.length === 0 || recentAvg.cash >= args.dailyFloor;
  // Avalia o MER necessário JÁ no cenário PÓS-escala (+15% de ads), não no
  // estado atual. Corrige o paradoxo do merNeeded (a métrica que governa a
  // decisão mudava quando a decisão era executada).
  const merNeededPostScale = avg.ads > 0 ? revenueNeeded / (avg.ads * 1.15) : null;
  const mediaScaleRisk =
    conversionDropOnScale ||
    (cashGap > 0 && avg.ads > 0 && merNeeded != null && merActual < merNeeded) ||
    (merNeededPostScale != null && merActual < merNeededPostScale) ||
    (cashGap > 0 && adsShare > 0.18);

  const rawFactors: Array<{
    key: string;
    label: string;
    actual: number;
    target: number;
    unit: "currency" | "number" | "percent" | "ratio";
    gap_pct: number;
    detail: string;
    status?: "ok" | "warning" | "critical";
  }> = [
    {
      key: "caixa",
      label: "Caixa de contribuicao",
      actual: avg.cash,
      target: args.dailyFloor,
      unit: "currency",
      gap_pct: gapPct(avg.cash, args.dailyFloor),
      detail: "Caixa real = receita menos custos variaveis (CMV, imposto, frete, outras) menos ads. Nao e mais 'receita - ads'. Se nao passa do piso, o resto e meio, nao fim.",
    },
    {
      key: "midia",
      label: "Eficiencia de midia",
      actual: merActual,
      target: merTarget,
      unit: "ratio",
      gap_pct: merTarget > 0 ? gapPct(merActual, merTarget) : 0,
      detail: "Mais budget so ajuda se o MER sustenta caixa; quando conversao cai junto, escala vira vazamento.",
    },
    {
      key: "conversao",
      label: "Conversao",
      actual: avg.conversion_rate,
      target: conversionNeeded,
      unit: "percent",
      gap_pct: gapPct(avg.conversion_rate, conversionNeeded),
      detail: "Nao e uma chave isolada. Trafego mais frio normalmente derruba esse numero, entao escala sem oferta forte piora.",
    },
    {
      key: "ticket",
      label: "Ticket / mix",
      actual: avg.avg_ticket,
      target: ticketNeeded,
      unit: "currency",
      gap_pct: gapPct(avg.avg_ticket, ticketNeeded),
      detail: "Mostra se cada pedido esta carregando caixa suficiente sem depender de volume comprado.",
    },
    {
      key: "estoque",
      label: "Produtos A prontos",
      actual: args.operational.top_a_ready.length,
      target: args.operational.top_a_count,
      unit: "number",
      gap_pct: args.operational.top_a_count > 0
        ? gapPct(args.operational.top_a_ready.length, args.operational.top_a_count)
        : 0,
      detail: args.operational.top_a_count > 0
        ? "Confere se os campeoes da curva ABC estao ativos, em estoque e com margem minima para receber demanda."
        : "Sem snapshot ABC suficiente para avaliar produto/estoque.",
    },
  ];
  const factors = rawFactors.map((factor) => ({ ...factor, status: factorStatus(factor.gap_pct) }));

  const isCashOk = totals.cash >= elapsedCashTarget;
  const projectedRevenue = avg.revenue * args.daysInMonth;
  const projectedCash = avg.cash * args.daysInMonth;
  const isSeasonalOk = projectedRevenue >= args.monthTarget;
  let primary = "caixa";
  if (inventoryBlocked) primary = "estoque";
  else if (mediaScaleRisk) primary = "midia";
  else if (conversionWeak) primary = "conversao";
  else if (ticketWeak) primary = "ticket";

  let title = "Manter o ritmo com travas";
  let summary = "Caixa e meta estao dentro do ritmo esperado. A decisao nao e escalar por escalar; e manter margem, estoque e MER.";
  if (!isCashOk || !isSeasonalOk) {
    if (primary === "estoque") {
      title = "Produto pode estar travando caixa";
      summary = "Antes de comprar mais trafego, garanta que os produtos A estejam disponiveis, ativos e com margem para receber demanda.";
    } else if (primary === "midia") {
      title = "Escala de midia esta arriscada";
      summary = conversionDropOnScale
        ? "Nos ultimos dias, ads subiu e conversao caiu. Isso e sinal classico de publico mais frio: aumentar verba tende a reduzir eficiencia."
        : "O caixa nao sustenta uma leitura simples de aumentar ads. Primeiro proteja MER, margem e mix.";
    } else if (primary === "conversao") {
      title = "O gargalo nao e simplesmente trafego";
      summary = "Aumentar sessoes agora pode derrubar conversao. A prioridade e oferta, produtos anunciados, PDP, frete e checkout.";
    } else if (primary === "ticket") {
      title = "Cada pedido gera pouco caixa";
      summary = "O problema parece mais mix/ticket/margem do que volume. Escalar compra de publico sem melhorar pedido medio pode piorar caixa.";
    } else {
      title = "Caixa abaixo do piso";
      summary = "A leitura principal e financeira: falta caixa liquido. A resposta deve priorizar canais baratos e produtos com margem antes de trafego frio.";
    }
  }

  let scaleRule: {
    mode: "blocked" | "limited" | "allowed";
    label: string;
    detail: string;
    max_increase_pct: number;
    stop_loss: string;
  };
  if (mediaScaleRisk || conversionWeak || inventoryBlocked || !isCashOk || !isCashTrendOk) {
    scaleRule = {
      mode: "blocked",
      label: "Nao escalar ads",
      detail: !isCashTrendOk && isCashOk
        ? "Caixa acumulado esta no ritmo, mas a tendencia dos ultimos 7 dias ja virou abaixo do piso. Estabilizar antes de escalar."
        : "Budget novo fica bloqueado ate caixa, conversao/MER e produto mostrarem que conseguem absorver demanda.",
      max_increase_pct: 0,
      stop_loss: "Se precisar testar, cortar no mesmo dia se MER ficar abaixo do necessario ou conversao cair mais de 8%.",
    };
  } else if (isSeasonalOk && projectedCash >= monthlyCashTarget) {
    scaleRule = {
      mode: "allowed",
      label: "Escala permitida com trava",
      detail: "Pode aumentar so campanhas com MER acima da necessidade e produto A em estoque; escala gradual, nao salto de budget.",
      max_increase_pct: 15,
      stop_loss: "Parar aumento se conversao cair mais de 8% ou caixa diario ficar abaixo do piso.",
    };
  } else {
    scaleRule = {
      mode: "limited",
      label: "Teste pequeno, nao escala",
      detail: "O cenario pede teste controlado, preferindo remarketing, campanha de alta intencao e CRM antes de publico frio.",
      max_increase_pct: 10,
      stop_loss: "Parar se MER ficar abaixo do necessario ou se a venda adicional nao virar caixa liquido.",
    };
  }

  const patternHint = args.patterns.best_weekday || args.patterns.best_hour
    ? ` Historico (${args.patterns.confidence}) sugere melhor janela: ${[args.patterns.best_weekday?.label, args.patterns.best_hour?.label].filter(Boolean).join(" / ")}.`
    : "";
  const actions: Array<{ title: string; detail: string; tone: "positive" | "warning" | "danger" | "neutral" }> = [];
  actions.push({
    title: scaleRule.label,
    detail: `${scaleRule.detail} Teto operacional estimado: ${brl(adsCeiling)}/dia, mas isso nao e convite para gastar; e limite de seguranca.`,
    tone: scaleRule.mode === "allowed" ? "positive" : scaleRule.mode === "limited" ? "warning" : "danger",
  });

  if (inventoryBlocked) {
    const ruptura = args.operational.top_a_out_of_stock;
    const baixaCobertura = args.operational.top_a_low_coverage;
    const partes: string[] = [];
    if (ruptura.length > 0) partes.push(`Sem estoque/inativos: ${productNames(ruptura)}.`);
    if (baixaCobertura.length > 0) {
      const nomes = baixaCobertura
        .slice(0, 3)
        .map((p) => `${p.name || p.sku} (~${p.coverage_days}d)`)
        .join("; ");
      partes.push(`Cobertura curta (< ${LOW_COVERAGE_DAYS}d): ${nomes}. Escalar ads aqui empurra trafego pra ruptura.`);
    }
    actions.push({
      title: "Arrumar produto antes de midia",
      detail: `${partes.join(" ")} Troque criativos/prateleiras para campeoes em estoque com folga antes de comprar demanda.`,
      tone: "danger",
    });
  }
  if (conversionWeak || conversionDropOnScale) {
    actions.push({
      title: "Investigar oferta e friccao",
      detail: "Olhar produtos anunciados, preco real, frete, PDP e checkout. Se a conversao ja esta fragil, mais sessao tende a vir mais fria e piorar o indicador.",
      tone: "warning",
    });
  }
  if (ticketWeak || marginPressure) {
    actions.push({
      title: "Aumentar caixa por pedido",
      detail: args.operational.top_a_ready.length > 0
        ? `Use kits, frete/brinde progressivo e vitrines com A em estoque: ${productNames(args.operational.top_a_ready)}. Evite cupom puro se ele derrubar margem.`
        : "Use kits, frete/brinde progressivo e mix de maior margem. Evite cupom puro se ele melhora faturamento e piora caixa.",
      tone: "warning",
    });
  }
  if (cashGap > 0) {
    actions.push({
      title: "Gerar caixa sem comprar publico frio",
      detail: `Priorize CRM, WhatsApp, email, recompra e ofertas para clientes quentes antes de abrir escala. Falta ${brl(cashGap)} de caixa no mes; precisa de ${brl(requiredCashDaily)}/dia liquido.${patternHint}`,
      tone: "warning",
    });
  } else {
    actions.push({
      title: "Proteger o ganho",
      detail: "Caixa acumulado acima do piso. Reinvestir so o excedente, com stop por MER/conversao e sem comprometer estoque dos campeoes.",
      tone: "positive",
    });
  }

  return {
    status: isCashOk && isSeasonalOk ? "ok" : isCashOk ? "attention" : "critical",
    title,
    summary,
    primary_factor: primary,
    factors,
    actions,
    scale_rule: scaleRule,
    averages: avg,
    requirements: {
      monthly_cash_target: round2(monthlyCashTarget),
      seasonal_revenue_target: round2(args.monthTarget),
      cash_gap: round2(cashGap),
      seasonal_revenue_gap: round2(seasonalGap),
      required_cash_per_remaining_day: round2(requiredCashDaily),
      required_revenue_per_remaining_day: round2(requiredRevenueDaily),
      effective_revenue_needed_per_day: round2(revenueNeeded),
      suggested_ads_ceiling_per_day: round2(adsCeiling),
      mer_needed: merNeeded ? round2(merNeeded) : null,
      mer_needed_post_scale: merNeededPostScale ? round2(merNeededPostScale) : null,
      mer_actual: round2(merActual),
      cash_trend_ok: isCashTrendOk,
      recent_cash_avg: round2(recentAvg.cash),
      projected_revenue: round2(projectedRevenue),
      projected_cash: round2(projectedCash),
    },
  };
}

function addPattern(map: Map<string, PatternRow>, key: string, label: string, value: number) {
  const current = map.get(key) || { key, label, revenue: 0, orders: 0, avg_ticket: 0 };
  current.revenue += value;
  current.orders += 1;
  current.avg_ticket = current.orders > 0 ? round2(current.revenue / current.orders) : 0;
  map.set(key, current);
}

async function fetchBehaviorPatterns(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  today: string
): Promise<BehaviorPatterns> {
  const start = addDays(today, -90);
  const sales = await fetchPaged<{ data_compra: string | null; valor: number | null }>(() =>
    admin
      .from("crm_vendas")
      .select("data_compra, valor")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", `${start}T00:00:00.000Z`)
      .lte("data_compra", `${today}T23:59:59.999Z`)
  );

  const byWeek = new Map<string, PatternRow>();
  const byWeekday = new Map<string, PatternRow>();
  const byHour = new Map<string, PatternRow>();
  const byCombo = new Map<string, PatternRow>();

  for (const sale of sales) {
    if (!sale.data_compra) continue;
    const date = new Date(sale.data_compra);
    const dateKey = ymdInBr(sale.data_compra);
    const value = toNumber(sale.valor);
    const week = weekOfMonth(dateKey);
    const weekday = weekdayLabel(dateKey);
    const hour = hourBand(date);
    addPattern(byWeek, String(week), `Semana ${week}`, value);
    addPattern(byWeekday, weekday, weekday, value);
    addPattern(byHour, hour, hour, value);
    addPattern(byCombo, `${week}-${weekday}`, `Semana ${week} / ${weekday}`, value);
  }

  const sortDesc = (rows: PatternRow[]) => rows.sort((a, b) => b.revenue - a.revenue);
  const sortAscQualified = (rows: PatternRow[]) => rows.filter((r) => r.orders >= 3).sort((a, b) => a.revenue - b.revenue);

  const weekRows = sortDesc([...byWeek.values()]);
  const weekdayRows = sortDesc([...byWeekday.values()]);
  const hourRows = sortDesc([...byHour.values()]);
  const comboRows = sortDesc([...byCombo.values()].filter((r) => r.orders >= 3));

  return {
    window_days: 90,
    orders: sales.length,
    confidence: sales.length >= 300 ? "alta" : sales.length >= 80 ? "media" : "baixa",
    best_week: weekRows[0] || null,
    worst_week: sortAscQualified([...byWeek.values()])[0] || null,
    best_weekday: weekdayRows[0] || null,
    worst_weekday: sortAscQualified([...byWeekday.values()])[0] || null,
    best_hour: hourRows[0] || null,
    worst_hour: sortAscQualified([...byHour.values()])[0] || null,
    best_combos: comboRows.slice(0, 5),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const params = request.nextUrl.searchParams;
    const todayParts = brDateParts();
    const monthParam = params.get("month") || `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}`;
    const [year, month] = monthParam.split("-").map(Number);
    const today = todayParts.ymd;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = lastDayOfMonth(year, month);
    const isCurrentMonth = monthParam === today.slice(0, 7);
    const end = isCurrentMonth ? today : monthEnd;
    const dates = daysBetweenInclusive(start, end);
    const daysInMonth = Number(monthEnd.slice(8, 10));
    const currentDay = isCurrentMonth ? todayParts.day : daysInMonth;

    const { data: settingsData } = await admin
      .from("workspace_financial_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const settings = mergeSettings((settingsData || null) as Record<string, unknown> | null);

    const [revenueResult, metaSpend, googleSpend, ga4Report, patterns, operational] = await Promise.all([
      fetchRevenue(admin, workspaceId, start, end),
      fetchMetaDailySpend(request, admin, workspaceId, start, end),
      fetchGoogleDailySpend(start, end),
      process.env.GA4_PROPERTY_ID
        ? getGA4DailyReport({ startDate: start, endDate: end }).catch(() => null)
        : Promise.resolve(null),
      fetchBehaviorPatterns(admin, workspaceId, today),
      fetchOperationalContext(admin, workspaceId),
    ]);

    const ga4Rows = new Map<string, { sessions: number; transactions: number }>();
    for (const row of ga4Report?.insights || []) {
      ga4Rows.set(yyyymmddToYmd(row.dateRaw), {
        sessions: toNumber(row.sessions),
        transactions: toNumber(row.transactions),
      });
    }

    const daily = buildDailyRows({
      dates,
      revenueRows: revenueResult.rows,
      revenueSource: revenueResult.source,
      metaSpend,
      googleSpend,
      ga4Rows,
      today,
      settings,
    });

    const completedRows = daily.filter((row) => !row.is_today);
    const totals = sumRows(daily);
    const todayRow = daily.find((row) => row.is_today) || daily[daily.length - 1] || null;
    const monthTarget = settings.annual_revenue_target * ((settings.monthly_seasonality[month - 1] ?? 8.33) / 100);
    const diagnosis = buildDiagnosis({
      dailyFloor: settings.daily_cash_floor_brl,
      monthTarget,
      daysInMonth,
      currentDay,
      rows: daily,
      completedRows,
      patterns,
      operational,
    });

    return NextResponse.json({
      period: {
        month: monthParam,
        start,
        end,
        today,
        days_in_month: daysInMonth,
        current_day: currentDay,
        remaining_days: Math.max(1, daysInMonth - currentDay + 1),
      },
      settings,
      sources: {
        revenue: revenueResult.source,
        configured: revenueResult.configured,
        meta_spend: metaSpend.size > 0,
        google_spend: googleSpend.size > 0,
        ga4: Boolean(ga4Report),
      },
      targets: {
        daily_cash_floor: settings.daily_cash_floor_brl,
        monthly_cash_floor: round2(settings.daily_cash_floor_brl * daysInMonth),
        seasonal_revenue_target: round2(monthTarget),
      },
      // Confiabilidade da leitura de caixa/margem: o caixa agora desconta
      // custos variáveis estimados; quanto disso é custo REAL vs default
      // depende da cobertura do snapshot ABC.
      reliability: {
        margin: operational.margin_reliability,
        coverage_pct: operational.abc_coverage_pct,
        revenue_source: revenueResult.source,
        revenue_configured: revenueResult.configured,
        cash_basis: "contribution",
        note:
          "Caixa = contribuição (receita − custos variáveis − ads). O piso de caixa pode precisar de recalibragem para esta base, que é menor que o antigo 'receita − ads'.",
      },
      totals,
      today: todayRow,
      daily,
      diagnosis,
      patterns,
      operational,
    }, {
      headers: { "Cache-Control": "private, max-age=180" },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
