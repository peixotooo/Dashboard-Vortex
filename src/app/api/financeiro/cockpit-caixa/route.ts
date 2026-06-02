import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { getInsights } from "@/lib/meta-api";
import { getGA4DailyReport, getGA4GoogleAdsCost } from "@/lib/ga4-api";
import { getVndaConfig, getVndaDailyReport } from "@/lib/vnda-api";

export const maxDuration = 120;

const TZ = "America/Sao_Paulo";

const DEFAULT_SETTINGS = {
  monthly_fixed_costs: 160000,
  tax_pct: 6,
  product_cost_pct: 25,
  other_expenses_pct: 5,
  monthly_seasonality: [6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98],
  target_profit_monthly: 0,
  safety_margin_pct: 5,
  annual_revenue_target: 8000000,
  invest_pct: 12,
  frete_pct: 6,
  desconto_pct: 3,
  daily_cash_floor_brl: 15500,
};

type Settings = typeof DEFAULT_SETTINGS;

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
  cash: number;
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

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
}): DailyRow[] {
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

    return {
      date,
      label: labelDate(date),
      revenue: round2(revenueValue),
      orders,
      ads: round2(ads),
      meta_spend: round2(metaSpend),
      google_spend: round2(googleSpend),
      cash: round2(revenueValue - ads),
      sessions,
      conversion_rate: sessions > 0 ? round2((orders / sessions) * 100) : 0,
      avg_ticket: orders > 0 ? round2(revenueValue / orders) : 0,
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
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);
  const sessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  return {
    revenue: round2(revenue),
    ads: round2(ads),
    cash: round2(cash),
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

function buildDiagnosis(args: {
  dailyFloor: number;
  monthTarget: number;
  daysInMonth: number;
  currentDay: number;
  rows: DailyRow[];
  completedRows: DailyRow[];
}) {
  const totals = sumRows(args.rows);
  const basis = args.completedRows.length > 0 ? args.completedRows : args.rows;
  const avg = avgRows(basis);
  const remainingDays = Math.max(1, args.daysInMonth - args.currentDay + 1);
  const monthlyCashTarget = args.dailyFloor * args.daysInMonth;
  const seasonalGap = Math.max(0, args.monthTarget - totals.revenue);
  const cashGap = Math.max(0, monthlyCashTarget - totals.cash);
  const requiredRevenueDaily = round2(seasonalGap / remainingDays);
  const requiredCashDaily = round2(cashGap / remainingDays);
  const requiredRevenueFromCash = requiredCashDaily + avg.ads;
  const revenueNeeded = Math.max(requiredRevenueDaily, requiredRevenueFromCash, avg.revenue);
  const ordersNeeded = avg.avg_ticket > 0 ? revenueNeeded / avg.avg_ticket : 0;
  const sessionsNeeded = avg.conversion_rate > 0 ? ordersNeeded / (avg.conversion_rate / 100) : 0;
  const conversionNeeded = avg.sessions > 0 && avg.avg_ticket > 0
    ? (ordersNeeded / avg.sessions) * 100
    : 0;
  const ticketNeeded = avg.orders > 0 ? revenueNeeded / avg.orders : 0;
  const adsCeiling = Math.max(0, avg.revenue - args.dailyFloor);
  const merNeeded = avg.ads > 0 ? revenueNeeded / avg.ads : null;

  const factors = [
    {
      key: "receita",
      label: "Receita",
      actual: avg.revenue,
      target: revenueNeeded,
      unit: "currency",
      gap_pct: gapPct(avg.revenue, revenueNeeded),
    },
    {
      key: "trafego",
      label: "Trafego",
      actual: avg.sessions,
      target: sessionsNeeded,
      unit: "number",
      gap_pct: gapPct(avg.sessions, sessionsNeeded),
    },
    {
      key: "conversao",
      label: "Conversao",
      actual: avg.conversion_rate,
      target: conversionNeeded,
      unit: "percent",
      gap_pct: gapPct(avg.conversion_rate, conversionNeeded),
    },
    {
      key: "ticket",
      label: "Ticket",
      actual: avg.avg_ticket,
      target: ticketNeeded,
      unit: "currency",
      gap_pct: gapPct(avg.avg_ticket, ticketNeeded),
    },
    {
      key: "ads",
      label: "Ads",
      actual: avg.ads,
      target: adsCeiling,
      unit: "currency",
      gap_pct: adsCeiling > 0 ? gapPct(adsCeiling, avg.ads) : (avg.ads > 0 ? -100 : 0),
    },
  ].map((factor) => ({ ...factor, status: factorStatus(factor.gap_pct) }));

  const isCashOk = totals.cash >= monthlyCashTarget * (args.currentDay / args.daysInMonth);
  const projectedRevenue = avg.revenue * args.daysInMonth;
  const projectedCash = avg.cash * args.daysInMonth;
  const isSeasonalOk = projectedRevenue >= args.monthTarget;
  const ranked = [...factors].sort((a, b) => a.gap_pct - b.gap_pct);
  let primary = ranked[0]?.key || "caixa";
  let title = "Manter o ritmo";
  let summary = "Caixa e meta estao dentro do ritmo esperado.";

  if (!isCashOk || !isSeasonalOk) {
    primary = ranked[0]?.key || "caixa";
    if (primary === "trafego") {
      title = "Falta volume de trafego";
      summary = "A conversao e o ticket nao explicam todo o gap; o gargalo principal e trazer mais demanda qualificada.";
    } else if (primary === "conversao") {
      title = "Conversao esta travando";
      summary = "As sessoes existem, mas nao viram pedidos no nivel necessario.";
    } else if (primary === "ticket") {
      title = "Ticket ou mix esta baixo";
      summary = "O volume de pedidos nao esta gerando receita suficiente por compra.";
    } else if (primary === "ads") {
      title = "Ads esta consumindo caixa";
      summary = "O investimento esta alto para o caixa gerado; a prioridade e proteger liquidez.";
    } else {
      title = "Receita abaixo do necessario";
      summary = "O gap aparece na receita total; olhar oferta, calendario comercial, CRM e produtos com estoque.";
    }
  }

  const actions: Array<{ title: string; detail: string; tone: "positive" | "warning" | "danger" | "neutral" }> = [];
  if (primary === "trafego") {
    actions.push({
      title: avg.cash >= args.dailyFloor ? "Aumentar volume com teto" : "Buscar volume barato primeiro",
      detail: avg.cash >= args.dailyFloor
        ? `Pode testar mais trafego mantendo ads perto de ${round2(adsCeiling).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/dia e monitorando MER.`
        : "Antes de escalar midia, acione CRM/WhatsApp/email e campanhas de alta intencao para gerar caixa com baixo custo.",
      tone: avg.cash >= args.dailyFloor ? "positive" : "warning",
    });
  }
  if (primary === "conversao") {
    actions.push({
      title: "Nao aumentar budget agora",
      detail: "Priorize oferta, PDP, checkout, frete e produtos de maior giro; aumentar trafego tende a comprar mais abandono.",
      tone: "danger",
    });
  }
  if (primary === "ticket") {
    actions.push({
      title: "Subir ticket antes de escalar",
      detail: "Puxe combos, brinde/frete progressivo e produtos A com estoque. Cuidado com cupom que melhora venda e piora caixa.",
      tone: "warning",
    });
  }
  if (primary === "ads") {
    actions.push({
      title: "Reduzir ou redistribuir ads",
      detail: `Teto operacional estimado: ${round2(adsCeiling).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/dia para cobrir caixa no ritmo atual.`,
      tone: "danger",
    });
  }
  actions.push({
    title: cashGap > 0 ? "Fechar o gap de caixa" : "Proteger o ganho",
    detail: cashGap > 0
      ? `Faltam ${round2(cashGap).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de caixa no mes; necessario gerar ${round2(requiredCashDaily).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/dia liquido daqui para frente.`
      : "Caixa acumulado acima do piso; so escale mantendo margem e estoque dos campeoes.",
    tone: cashGap > 0 ? "warning" : "positive",
  });

  return {
    status: isCashOk && isSeasonalOk ? "ok" : isCashOk ? "attention" : "critical",
    title,
    summary,
    primary_factor: primary,
    factors,
    actions,
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
) {
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

    const [revenueResult, metaSpend, googleSpend, ga4Report, patterns] = await Promise.all([
      fetchRevenue(admin, workspaceId, start, end),
      fetchMetaDailySpend(request, admin, workspaceId, start, end),
      fetchGoogleDailySpend(start, end),
      process.env.GA4_PROPERTY_ID
        ? getGA4DailyReport({ startDate: start, endDate: end }).catch(() => null)
        : Promise.resolve(null),
      fetchBehaviorPatterns(admin, workspaceId, today),
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
      totals,
      today: todayRow,
      daily,
      diagnosis,
      patterns,
    }, {
      headers: { "Cache-Control": "private, max-age=180" },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
