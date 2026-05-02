"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  Target,
  ShoppingCart,
  Users,
  Receipt,
  Percent,
  Calculator,
  Landmark,
} from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { BestHoursHeatmap } from "@/components/dashboard/best-hours-heatmap";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { OverviewSummary } from "@/components/dashboard/overview-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent, datePresetToTimeRange } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import { useChartTheme } from "@/hooks/use-chart-theme";
import type { DatePreset } from "@/lib/types";

// --- Helpers ---

function extractAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!actions) return 0;
  const action = actions.find((a) => a.action_type === type);
  return action ? parseFloat(action.value || "0") : 0;
}

function extractActionValue(
  actionValues: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!actionValues) return 0;
  const action = actionValues.find((a) => a.action_type === type);
  return action ? parseFloat(action.value || "0") : 0;
}

// --- Types ---

interface GA4Totals {
  sessions: number;
  users: number;
  newUsers: number;
  transactions: number;
  revenue: number;
  pageViews: number;
  addToCarts: number;
  checkouts: number;
}

interface GA4DailyRow {
  date: string;
  dateRaw: string;
  sessions: number;
  users: number;
  transactions: number;
  revenue: number;
}

interface MetaComparison {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  revenue: number;
  purchases: number;
  roas: number;
}

interface GoogleAdsTotals {
  cost: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
}

interface GoogleAdsDailyRow {
  date: string;
  dateRaw: string;
  cost: number;
  clicks: number;
  impressions: number;
}

interface DailyRow {
  date: string;
  spend: number;
  googleAdsCost: number;
  totalSpend: number;
  revenue: number;
  roas: number;
  sessions: number;
  pedidos: number;
  ticketMedio: number;
  txConversao: number;
  cpc: number;
  impressions: number;
  clicks: number;
}

interface VndaTotals {
  orders: number;
  revenue: number;
  subtotal: number;
  discount: number;
  shipping: number;
  avgTicket: number;
  productsSold: number;
}

interface VndaDailyRow {
  date: string;
  dateRaw: string;
  orders: number;
  revenue: number;
}

interface FinancialSettings {
  monthly_fixed_costs: number;
  tax_pct: number;
  product_cost_pct: number;
  other_expenses_pct: number;
  monthly_seasonality: number[];
  target_profit_monthly: number;
  safety_margin_pct: number;
  annual_revenue_target: number;
  invest_pct: number;
  frete_pct: number;
  desconto_pct: number;
  isDefault: boolean;
}

const FIN_DEFAULTS: FinancialSettings = {
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
  isDefault: true,
};

interface OverviewData {
  // Meta
  spend: number;
  cpc: number;
  ctr: number;
  impressions: number;
  clicks: number;
  reach: number;
  // Google Ads
  googleAdsCost: number;
  gadsConfigured: boolean;
  // Combined investment
  totalInvestment: number;
  // GA4
  revenue: number;
  sessions: number;
  pedidos: number;
  ticketMedio: number;
  txConversao: number;
  roas: number;
  ga4Configured: boolean;
  // VNDA
  vndaConfigured: boolean;
  vndaShipping: number;
  vndaDiscount: number;
  // Funnel
  addToCarts: number;
  checkouts: number;
  // Combined
  trendData: DailyRow[];
  dailyData: DailyRow[];
  // Comparison
  metaComparison: MetaComparison | null;
  ga4Comparison: GA4Totals | null;
  vndaComparison: VndaTotals | null;
  gadsComparison: GoogleAdsTotals | null;
  // Financial
  finSettings: FinancialSettings;
}

export default function OverviewPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | undefined>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData>({
    spend: 0,
    cpc: 0,
    ctr: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    googleAdsCost: 0,
    gadsConfigured: false,
    totalInvestment: 0,
    revenue: 0,
    sessions: 0,
    pedidos: 0,
    ticketMedio: 0,
    txConversao: 0,
    roas: 0,
    ga4Configured: false,
    vndaConfigured: false,
    vndaShipping: 0,
    vndaDiscount: 0,
    addToCarts: 0,
    checkouts: 0,
    trendData: [],
    dailyData: [],
    metaComparison: null,
    ga4Comparison: null,
    vndaComparison: null,
    gadsComparison: null,
    finSettings: FIN_DEFAULTS,
  });

  useEffect(() => {
    if (!accountId) return;

    async function fetchData() {
      setLoading(true);
      try {
        // Determine which accounts to fetch
        const accountIds = accountId === "all"
          ? accounts.map((a) => a.id)
          : [accountId];

        // Build date query params — use since/until for custom ranges
        const dateParams = datePreset === "custom" && customRange
          ? `date_preset=custom&since=${customRange.since}&until=${customRange.until}`
          : `date_preset=${datePreset}`;

        // Fetch Meta (per-account) + GA4 + VNDA in parallel
        const wsHeaders: Record<string, string> = {};
        if (workspace?.id) wsHeaders["x-workspace-id"] = workspace.id;

        const [insightsResults, ga4Res, vndaRes, finRes] = await Promise.all([
          // Fetch insights for each account in parallel
          Promise.all(
            accountIds.map((id) =>
              fetch(
                `/api/insights?object_id=${id}&level=account&${dateParams}&include_comparison=true`,
                { headers: wsHeaders }
              ).then((r) => r.json())
            )
          ),
          fetch(
            `/api/ga4/insights?${dateParams}&include_comparison=true`,
            { headers: wsHeaders }
          ),
          fetch(
            `/api/vnda/insights?${dateParams}&include_comparison=true`,
            { headers: wsHeaders }
          ),
          workspace?.id
            ? fetch("/api/financial-settings", { headers: wsHeaders })
            : Promise.resolve(null),
        ]);

        const ga4Data = await ga4Res.json();
        const vndaData = await vndaRes.json();
        const finSettings: FinancialSettings = finRes
          ? await finRes.json()
          : FIN_DEFAULTS;

        // --- Process & aggregate Meta data across all accounts ---
        interface MetaDailyItem {
          date: string;
          dateRaw: string;
          spend: number;
          cpc: number;
          impressions: number;
          clicks: number;
          metaRevenue: number;
          metaPurchases: number;
        }

        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalReach = 0;
        let totalMetaRevenue = 0;
        let totalMetaPurchases = 0;

        // Aggregate daily data across accounts using dateRaw as key
        const dailyAggMap = new Map<string, MetaDailyItem>();

        // Aggregate comparison data across accounts
        let aggComparison: MetaComparison | null = null;

        for (const insightsData of insightsResults) {
          const metaInsights = insightsData.insights || [];

          for (const row of metaInsights) {
            const spend = parseFloat((row.spend as string) || "0");
            const impressions = parseFloat((row.impressions as string) || "0");
            const clicks = parseFloat((row.clicks as string) || "0");
            const reach = parseFloat((row.reach as string) || "0");

            const actions = row.actions as Array<{ action_type: string; value: string }> | undefined;
            const actionValues = row.action_values as Array<{ action_type: string; value: string }> | undefined;
            const metaRevenue = extractActionValue(actionValues, "purchase");
            const metaPurchases = extractAction(actions, "purchase");

            totalSpend += spend;
            totalImpressions += impressions;
            totalClicks += clicks;
            totalReach += reach;
            totalMetaRevenue += metaRevenue;
            totalMetaPurchases += metaPurchases;

            const dateStart = (row.date_start as string) || "";
            const dateRaw = dateStart.slice(0, 10);
            const existing = dailyAggMap.get(dateRaw);
            if (existing) {
              existing.spend += spend;
              existing.impressions += impressions;
              existing.clicks += clicks;
              existing.metaRevenue += metaRevenue;
              existing.metaPurchases += metaPurchases;
              existing.cpc = existing.clicks > 0 ? existing.spend / existing.clicks : 0;
            } else {
              dailyAggMap.set(dateRaw, {
                date: dateStart.slice(8, 10) + "/" + dateStart.slice(5, 7),
                dateRaw,
                spend,
                cpc: clicks > 0 ? spend / clicks : 0,
                impressions,
                clicks,
                metaRevenue,
                metaPurchases,
              });
            }
          }

          // Aggregate comparison
          const comp = insightsData.comparison;
          if (comp) {
            if (!aggComparison) {
              aggComparison = { spend: 0, impressions: 0, clicks: 0, reach: 0, ctr: 0, cpc: 0, revenue: 0, purchases: 0, roas: 0 };
            }
            aggComparison.spend += comp.spend || 0;
            aggComparison.impressions += comp.impressions || 0;
            aggComparison.clicks += comp.clicks || 0;
            aggComparison.reach += comp.reach || 0;
            aggComparison.revenue += comp.revenue || 0;
            aggComparison.purchases += comp.purchases || 0;
          }
        }

        // Recalculate derived comparison metrics
        if (aggComparison) {
          aggComparison.ctr = aggComparison.impressions > 0 ? (aggComparison.clicks / aggComparison.impressions) * 100 : 0;
          aggComparison.cpc = aggComparison.clicks > 0 ? aggComparison.spend / aggComparison.clicks : 0;
          aggComparison.roas = aggComparison.spend > 0 ? aggComparison.revenue / aggComparison.spend : 0;
        }

        // Round daily values
        const metaDaily: MetaDailyItem[] = [...dailyAggMap.values()].map((d) => ({
          ...d,
          spend: parseFloat(d.spend.toFixed(2)),
          cpc: parseFloat(d.cpc.toFixed(2)),
          metaRevenue: parseFloat(d.metaRevenue.toFixed(2)),
        }));

        const totalCtr =
          totalImpressions > 0
            ? (totalClicks / totalImpressions) * 100
            : 0;
        const totalCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

        // --- Process GA4 data ---
        const ga4Configured = ga4Data.configured === true;
        const ga4Insights: GA4DailyRow[] = (ga4Data.insights || []).map(
          (row: Record<string, unknown>) => ({
            date: row.date as string,
            dateRaw: (row.dateRaw as string) || "",
            sessions: (row.sessions as number) || 0,
            users: (row.users as number) || 0,
            transactions: (row.transactions as number) || 0,
            revenue: (row.revenue as number) || 0,
          })
        );
        const ga4Totals: GA4Totals = ga4Data.totals || {
          sessions: 0,
          users: 0,
          newUsers: 0,
          transactions: 0,
          revenue: 0,
          pageViews: 0,
          addToCarts: 0,
          checkouts: 0,
        };

        // --- Process Google Ads data (from GA4 response) ---
        const gadsConfigured = ga4Data.googleAds != null;
        const gadsTotals: GoogleAdsTotals = ga4Data.googleAds?.totals || { cost: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0 };
        const gadsDaily: GoogleAdsDailyRow[] = (ga4Data.googleAds?.daily || []).map(
          (row: Record<string, unknown>) => ({
            date: row.date as string,
            dateRaw: (row.dateRaw as string) || "",
            cost: (row.cost as number) || 0,
            clicks: (row.clicks as number) || 0,
            impressions: (row.impressions as number) || 0,
          })
        );

        // --- Process VNDA data ---
        const vndaConfigured = vndaData.configured === true;
        const vndaInsights: VndaDailyRow[] = (vndaData.insights || []).map(
          (row: Record<string, unknown>) => ({
            date: row.date as string,
            dateRaw: (row.dateRaw as string) || "",
            orders: (row.orders as number) || 0,
            revenue: (row.revenue as number) || 0,
          })
        );
        const vndaTotals: VndaTotals = vndaData.totals || {
          orders: 0,
          revenue: 0,
          subtotal: 0,
          discount: 0,
          shipping: 0,
          avgTicket: 0,
          productsSold: 0,
        };

        // --- Merge daily data (UNION of Meta + Google Ads + GA4 + VNDA by dateRaw) ---
        // Priority: VNDA > GA4 > Meta for revenue/orders
        const normDate = (raw: string) =>
          raw.length === 8 && !raw.includes("-")
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw.slice(0, 10);
        const toDisplay = (raw: string) => `${raw.slice(8, 10)}/${raw.slice(5, 7)}`;

        const metaMap = new Map(metaDaily.map((d) => [d.dateRaw, d]));
        const ga4Map = new Map(ga4Insights.map((d) => [normDate(d.dateRaw), d]));
        const vndaMap = new Map(vndaInsights.map((d) => [normDate(d.dateRaw), d]));
        const gadsMap = new Map(gadsDaily.map((d) => [normDate(d.dateRaw), d]));

        const allDatesSet = new Set<string>();
        for (const [k] of metaMap) allDatesSet.add(k);
        for (const [k] of ga4Map) allDatesSet.add(k);
        for (const [k] of vndaMap) allDatesSet.add(k);
        for (const [k] of gadsMap) allDatesSet.add(k);

        // Filter dates to only include those within the selected period
        const expectedRange = datePresetToTimeRange(datePreset, customRange);
        const allDates = [...allDatesSet]
          .filter((d) => d >= expectedRange.since && d <= expectedRange.until)
          .sort();

        const trendData: DailyRow[] = allDates.map((rawDate) => {
          const metaDay = metaMap.get(rawDate);
          const ga4Day = ga4Map.get(rawDate);
          const vndaDay = vndaMap.get(rawDate);
          const gadsDay = gadsMap.get(rawDate);

          const spend = metaDay?.spend ?? 0;
          const googleAdsCost = gadsDay?.cost ?? 0;
          const totalDaySpend = spend + googleAdsCost;

          const revenue = vndaConfigured
            ? (vndaDay?.revenue ?? 0)
            : ga4Configured
              ? (ga4Day?.revenue ?? 0)
              : (metaDay?.metaRevenue ?? 0);
          const transactions = vndaConfigured
            ? (vndaDay?.orders ?? 0)
            : ga4Configured
              ? (ga4Day?.transactions ?? 0)
              : (metaDay?.metaPurchases ?? 0);
          const sessions = ga4Day?.sessions ?? 0;

          return {
            date: toDisplay(rawDate),
            spend: parseFloat(spend.toFixed(2)),
            googleAdsCost: parseFloat(googleAdsCost.toFixed(2)),
            totalSpend: parseFloat(totalDaySpend.toFixed(2)),
            revenue: parseFloat(revenue.toFixed(2)),
            roas:
              totalDaySpend > 0
                ? parseFloat((revenue / totalDaySpend).toFixed(2))
                : 0,
            sessions,
            pedidos: transactions,
            ticketMedio:
              transactions > 0
                ? parseFloat((revenue / transactions).toFixed(2))
                : 0,
            txConversao:
              sessions > 0
                ? parseFloat(
                    ((transactions / sessions) * 100).toFixed(2)
                  )
                : 0,
            cpc: metaDay?.cpc ?? 0,
            impressions: metaDay?.impressions ?? 0,
            clicks: metaDay?.clicks ?? 0,
          };
        });

        // --- Calculate totals from trendData (already filtered by datePreset) ---
        const totalRevenue = trendData.reduce((s, d) => s + d.revenue, 0);
        const totalPedidos = trendData.reduce((s, d) => s + d.pedidos, 0);
        const totalSessions = trendData.reduce((s, d) => s + d.sessions, 0);
        const totalInvestment = trendData.reduce((s, d) => s + d.totalSpend, 0);
        const totalRoas =
          totalInvestment > 0 ? totalRevenue / totalInvestment : 0;
        const totalTicketMedio =
          totalPedidos > 0 ? totalRevenue / totalPedidos : 0;
        const totalTxConversao =
          totalSessions > 0
            ? (totalPedidos / totalSessions) * 100
            : 0;

        const dailyData = [...trendData].reverse();

        setData({
          spend: totalSpend,
          cpc: totalCpc,
          ctr: totalCtr,
          impressions: totalImpressions,
          clicks: totalClicks,
          reach: totalReach,
          googleAdsCost: gadsTotals.cost,
          gadsConfigured,
          totalInvestment,
          revenue: totalRevenue,
          sessions: totalSessions,
          pedidos: totalPedidos,
          ticketMedio: totalTicketMedio,
          txConversao: totalTxConversao,
          roas: totalRoas,
          ga4Configured,
          vndaConfigured,
          vndaShipping: vndaTotals.shipping,
          vndaDiscount: vndaTotals.discount,
          addToCarts: ga4Configured ? ga4Totals.addToCarts : 0,
          checkouts: ga4Configured ? ga4Totals.checkouts : 0,
          trendData,
          dailyData,
          metaComparison: aggComparison,
          ga4Comparison: ga4Data.comparison || null,
          vndaComparison: vndaData.comparison || null,
          gadsComparison: ga4Data.googleAdsComparison || null,
          finSettings,
        });
      } catch {
        // Keep default empty state
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [datePreset, customRange, accountId, accounts, workspace?.id]);

  function calcChange(
    current: number,
    previous: number | undefined
  ): number | undefined {
    if (previous === undefined || previous === 0) return undefined;
    return ((current - previous) / previous) * 100;
  }

  const mc = data.metaComparison;
  const gc = data.ga4Comparison;
  const vc = data.vndaComparison;
  const gadsc = data.gadsComparison;

  // Previous period revenue: VNDA > GA4 > Meta
  const prevRevenue = data.vndaConfigured && vc
    ? vc.revenue
    : data.ga4Configured && gc
      ? gc.revenue
      : mc?.revenue;
  const prevPurchases = data.vndaConfigured && vc
    ? vc.orders
    : data.ga4Configured && gc
      ? gc.transactions
      : mc?.purchases;

  // Previous period total investment (Meta + Google Ads)
  const prevMetaSpend = mc?.spend ?? 0;
  const prevGadsCost = gadsc?.cost ?? 0;
  const prevTotalInvestment = prevMetaSpend + prevGadsCost;

  // Previous period ROAS (uses total investment)
  const prevRoas =
    prevTotalInvestment > 0 && prevRevenue !== undefined ? prevRevenue / prevTotalInvestment : undefined;
  // Previous period ticket médio
  const prevTicketMedio =
    prevPurchases && prevPurchases > 0 && prevRevenue !== undefined
      ? prevRevenue / prevPurchases
      : undefined;
  // Previous period tx conversão — uses GA4 sessions for denominator, VNDA/GA4 orders for numerator
  const prevTxOrders = data.vndaConfigured && vc ? vc.orders : gc?.transactions;
  const prevTxConversao =
    gc && gc.sessions > 0 && prevTxOrders
      ? (prevTxOrders / gc.sessions) * 100
      : undefined;

  // Revenue source badge: VNDA > GA4 > Meta
  const revenueSource = data.vndaConfigured ? "VNDA" : data.ga4Configured ? "GA4" : "Meta";
  const revenueColor = data.vndaConfigured ? "#10b981" : data.ga4Configured ? "#f97316" : "#818cf8";

  // Investment badge
  const investBadge = data.gadsConfigured ? "Meta + Google" : "Meta";
  const investColor = data.gadsConfigured ? "#8b5cf6" : "#818cf8";

  // ROAS badge
  const roasSources = [data.gadsConfigured ? "Meta + Google" : "Meta"];
  if (data.vndaConfigured) roasSources.push("VNDA");
  else if (data.ga4Configured) roasSources.push("GA4");
  const roasBadge = roasSources.join(" / ");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral Meta Ads{data.gadsConfigured ? " + Google Ads" : ""}{data.ga4Configured ? " + GA4" : ""}{data.vndaConfigured ? " + VNDA" : ""}
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} customRange={customRange} onCustomRangeChange={setCustomRange} />
      </div>

      {/* KPI Cards - Row 1: Revenue metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Invest. Total"
          value={formatCurrency(data.totalInvestment)}
          change={calcChange(data.totalInvestment, prevTotalInvestment || undefined)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          badge={investBadge}
          badgeColor={investColor}
        />
        <KpiCard
          title="Receita"
          value={formatCurrency(data.revenue)}
          change={calcChange(data.revenue, prevRevenue)}
          icon={TrendingUp}
          iconColor="text-blue-400"
          loading={loading}
          badge={revenueSource}
          badgeColor={revenueColor}
        />
        <div className="relative group">
          <KpiCard
            title="ROAS"
            value={`${data.roas.toFixed(2)}x`}
            change={calcChange(data.roas, prevRoas)}
            icon={Target}
            iconColor="text-purple-400"
            loading={loading}
            badge={roasBadge}
            badgeColor="#8b5cf6"
          />
          <Link
            href="/simulador"
            className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Calculator className="h-3 w-3" /> Simular
          </Link>
        </div>
        <KpiCard
          title="Pedidos"
          value={formatNumber(data.pedidos)}
          change={calcChange(data.pedidos, prevPurchases)}
          icon={ShoppingCart}
          iconColor="text-warning"
          loading={loading}
          badge={revenueSource}
          badgeColor={revenueColor}
        />
      </div>

      {/* KPI Cards - Row 2: Breakdown + Performance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Invest. Meta"
          value={formatCurrency(data.spend)}
          change={calcChange(data.spend, mc?.spend)}
          icon={DollarSign}
          iconColor="text-blue-400"
          loading={loading}
          badge="Meta"
          badgeColor="#818cf8"
        />
        {data.gadsConfigured ? (
          <KpiCard
            title="Invest. Google"
            value={formatCurrency(data.googleAdsCost)}
            change={calcChange(data.googleAdsCost, gadsc?.cost)}
            icon={DollarSign}
            iconColor="text-green-400"
            loading={loading}
            badge="Google Ads"
            badgeColor="#4285f4"
          />
        ) : (
          <KpiCard
            title="Sessões"
            value={formatNumber(data.sessions)}
            change={calcChange(data.sessions, gc?.sessions)}
            icon={Users}
            iconColor="text-cyan-400"
            loading={loading}
            badge="GA4"
            badgeColor="#f97316"
          />
        )}
        <KpiCard
          title="TX Conversão"
          value={formatPercent(data.txConversao)}
          change={calcChange(data.txConversao, prevTxConversao)}
          icon={Percent}
          iconColor="text-orange-400"
          loading={loading}
          badge={revenueSource}
          badgeColor={revenueColor}
        />
        <KpiCard
          title="Ticket Médio"
          value={formatCurrency(data.ticketMedio)}
          change={calcChange(data.ticketMedio, prevTicketMedio)}
          icon={Receipt}
          iconColor="text-emerald-400"
          loading={loading}
          badge={revenueSource}
          badgeColor={revenueColor}
        />
      </div>

      {/* Resumo: mais vendidos + novos vs recorrentes (últimos 7 dias) */}
      <OverviewSummary />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Investimento x Receita"
          data={data.trendData as unknown as Array<Record<string, unknown>>}
          lines={[
            { key: "totalSpend", label: "Invest. Total (R$)", color: "#22c55e" },
            { key: "revenue", label: "Receita (R$)", color: "#3b82f6" },
          ]}
          loading={loading}
        />
        <RoasChart data={data.trendData} loading={loading} />
      </div>

      {/* Sessões + TX Conversão Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Sessões"
          data={data.trendData as unknown as Array<Record<string, unknown>>}
          lines={[
            { key: "sessions", label: "Sessões", color: "#06b6d4" },
          ]}
          loading={loading}
        />
        <TrendChart
          title="Taxa de Conversão"
          data={data.trendData as unknown as Array<Record<string, unknown>>}
          lines={[
            { key: "txConversao", label: "TX Conversão (%)", color: "#f97316" },
          ]}
          loading={loading}
        />
      </div>

      {/* Financial Health */}
      <FinancialHealth
        trendData={data.trendData}
        totalInvestment={data.totalInvestment}
        vndaConfigured={data.vndaConfigured}
        finSettings={data.finSettings}
        loading={loading}
      />

      {/* Funnel E-commerce */}
      <FunnelSection
        sessions={data.sessions}
        addToCarts={data.addToCarts}
        checkouts={data.checkouts}
        pedidos={data.pedidos}
        ga4Configured={data.ga4Configured}
        loading={loading}
      />

      {/* Best hours heatmap (GA4) */}
      {data.ga4Configured && <BestHoursHeatmap />}

      {/* Controle Diário */}
      <div className="flex items-center gap-3 -mb-4">
        <span className="text-xs font-medium text-muted-foreground">Fonte:</span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#818cf8" }} />
          <span className="text-xs text-muted-foreground">Meta</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f97316" }} />
          <span className="text-xs text-muted-foreground">GA4</span>
        </span>
        {data.gadsConfigured && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#4285f4" }} />
            <span className="text-xs text-muted-foreground">Google Ads</span>
          </span>
        )}
        {data.vndaConfigured && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#10b981" }} />
            <span className="text-xs text-muted-foreground">VNDA</span>
          </span>
        )}
      </div>
      <PerformanceTable
        title="Controle Diário"
        columns={[
          { key: "date", label: "Data" },
          { key: "pedidos", label: "Pedidos", format: "number", align: "right" },
          { key: "ticketMedio", label: "Ticket Médio", format: "currency", align: "right" },
          { key: "txConversao", label: "TX Conv.", format: "percent", align: "right" },
          { key: "spend", label: "Invest. Meta", format: "currency", align: "right" },
          ...(data.gadsConfigured ? [{ key: "googleAdsCost", label: "Invest. Google", format: "currency" as const, align: "right" as const }] : []),
          { key: "totalSpend", label: "Invest. Total", format: "currency", align: "right" },
          { key: "revenue", label: "Receita", format: "currency", align: "right" },
          { key: "roas", label: "ROAS", format: "text", align: "right" },
        ]}
        data={data.dailyData.map((row) => ({
          ...row,
          roas: `${row.roas.toFixed(2)}x`,
          txConversao: row.txConversao.toFixed(2),
        }))}
        loading={loading}
      />
    </div>
  );
}

// --- Financial Health ---

function FinancialHealth({
  trendData,
  totalInvestment,
  vndaConfigured,
  finSettings,
  loading,
}: {
  trendData: DailyRow[];
  totalInvestment: number;
  vndaConfigured: boolean;
  finSettings: FinancialSettings;
  loading: boolean;
}) {
  const calc = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-indexed
    const currentMonthStr = String(currentMonth + 1).padStart(2, "0");
    const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
    const currentDay = now.getDate();

    // Filter trend data for current month (date format: DD/MM)
    const monthData = trendData.filter((d) => d.date.slice(3, 5) === currentMonthStr);
    const monthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0);
    const daysWithData = monthData.length;
    const avgDaily = daysWithData > 0 ? monthRevenue / daysWithData : 0;
    const projectedRevenue = avgDaily * daysInMonth;
    const daysRemaining = daysInMonth - currentDay;

    // --- META: top-down, FIXA no mês ---
    const { annual_revenue_target, invest_pct, frete_pct, desconto_pct,
            tax_pct, product_cost_pct, other_expenses_pct,
            monthly_fixed_costs, monthly_seasonality } = finSettings;
    const seasonalityWeight = (monthly_seasonality?.[currentMonth] ?? 8.33) / 100;
    const monthTarget = annual_revenue_target * seasonalityWeight;

    // --- PE: usa premissas CONFIGURADAS (fixas no mês) ---
    const totalVarCostPctConfig = invest_pct + frete_pct + desconto_pct + tax_pct + product_cost_pct + other_expenses_pct;
    const contributionMarginPctConfig = 100 - totalVarCostPctConfig;
    const breakEven = contributionMarginPctConfig > 0
      ? monthly_fixed_costs / (contributionMarginPctConfig / 100)
      : 0;

    // --- VALORES REAIS: para monitoramento/desvios (NÃO afetam Meta/PE) ---
    const monthInvestment = monthData.reduce((s, d) => s + d.totalSpend, 0);
    const investPercReal = monthRevenue > 0 ? (monthInvestment / monthRevenue) * 100 : 0;
    const fretePercReal = frete_pct;     // Sem dado diário de frete — usa valor configurado
    const descontoPercReal = desconto_pct; // Sem dado diário de desconto — usa valor configurado

    // Desvios: real vs planejado
    const investDeviation = investPercReal - invest_pct;
    const freteDeviation = fretePercReal - frete_pct;
    const descontoDeviation = descontoPercReal - desconto_pct;

    // Progress
    const progressPercent = monthTarget > 0 ? (monthRevenue / monthTarget) * 100 : 0;
    const breakEvenPercent = monthTarget > 0 ? (breakEven / monthTarget) * 100 : 0;
    const aboveBreakEven = monthRevenue >= breakEven;
    const marginAboveBE = monthRevenue - breakEven;

    // Cumulative chart data
    const cumulativeData: Array<{
      day: number;
      revenue: number;
      target: number;
      breakEven: number;
    }> = [];
    let cumRevenue = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, "0");
      const dayData = monthData.find((d) => d.date.startsWith(dayStr + "/"));
      if (dayData) cumRevenue += dayData.revenue;
      cumulativeData.push({
        day,
        revenue: day <= currentDay ? cumRevenue : 0,
        target: (monthTarget / daysInMonth) * day,
        breakEven,
      });
    }
    // Mark future days
    const chartData = cumulativeData.map((d) => ({
      ...d,
      revenue: d.day <= currentDay ? d.revenue : undefined,
    }));

    return {
      monthRevenue,
      projectedRevenue,
      avgDaily,
      daysRemaining,
      daysInMonth,
      currentDay,
      daysWithData,
      // Real values
      investPercReal,
      fretePercReal,
      descontoPercReal,
      // Configured values
      investPctPlan: invest_pct,
      fretePctPlan: frete_pct,
      descontoPctPlan: desconto_pct,
      // Deviations
      investDeviation,
      freteDeviation,
      descontoDeviation,
      contributionMarginPct: contributionMarginPctConfig,
      breakEven,
      monthTarget,
      progressPercent: Math.min(progressPercent, 150),
      breakEvenPercent: Math.min(breakEvenPercent, 100),
      aboveBreakEven,
      marginAboveBE,
      seasonalityWeight: (monthly_seasonality?.[currentMonth] ?? 8.33),
      chartData,
    };
  }, [trendData, totalInvestment, vndaConfigured, finSettings]);

  const chart = useChartTheme();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Saúde Financeira
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Saúde Financeira do Mês
          </CardTitle>
          <div className="flex items-center gap-2">
            {calc.aboveBreakEven ? (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-success/10 text-success">
                Acima do PE
              </span>
            ) : (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-destructive/10 text-destructive">
                Abaixo do PE
              </span>
            )}
            <Link
              href="/simulador/diagnostico"
              className="text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
            >
              Entender Metricas
            </Link>
            {finSettings.isDefault && (
              <Link
                href="/simulador/config"
                className="text-xs text-warning hover:underline"
              >
                Configurar
              </Link>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Meta Mensal</p>
            <p className="text-xl font-bold">{formatCurrency(calc.monthTarget)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              sazonalidade: {calc.seasonalityWeight.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Ponto de Equilíbrio</p>
            <p className={`text-xl font-bold ${calc.aboveBreakEven ? "text-success" : "text-destructive"}`}>
              {formatCurrency(calc.breakEven)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              GF / MC ({calc.contributionMarginPct.toFixed(1)}%)
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Receita Atual</p>
            <p className="text-xl font-bold">{formatCurrency(calc.monthRevenue)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              proj: {formatCurrency(calc.projectedRevenue)} | {calc.daysRemaining}d restantes
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">MC%</p>
            <p className={`text-xl font-bold ${calc.contributionMarginPct > 0 ? "text-success" : "text-destructive"}`}>
              {calc.contributionMarginPct.toFixed(1)}%
            </p>
            <p className={`text-[10px] mt-0.5 ${calc.marginAboveBE >= 0 ? "text-success" : "text-destructive"}`}>
              {calc.marginAboveBE >= 0 ? "+" : ""}{formatCurrency(calc.marginAboveBE)} vs PE
            </p>
          </div>
        </div>

        {/* Progress bar with break-even marker */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Progresso vs Meta</span>
            <span>{Math.min(calc.progressPercent, 100).toFixed(0)}%</span>
          </div>
          <div className="relative">
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  calc.aboveBreakEven
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                    : "bg-gradient-to-r from-red-500 to-orange-400"
                }`}
                style={{ width: `${Math.min(calc.progressPercent, 100)}%` }}
              />
            </div>
            {/* Break-even marker */}
            {calc.breakEvenPercent > 0 && calc.breakEvenPercent <= 100 && (
              <div
                className="absolute top-0 h-3 w-0.5 bg-foreground/60"
                style={{ left: `${calc.breakEvenPercent}%` }}
              >
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                  PE
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
            <span>R$ 0</span>
            <span>{formatCurrency(calc.monthTarget)}</span>
          </div>
        </div>

        {/* Cumulative Revenue Chart */}
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={calc.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={calc.aboveBreakEven ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={calc.aboveBreakEven ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis
                dataKey="day"
                stroke={chart.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(d) => `${d}`}
              />
              <YAxis
                stroke={chart.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={chart.tooltipStyle}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) => {
                  const label = name === "revenue" ? "Receita Acum." : name === "target" ? "Ritmo Meta" : "Ponto Equilíbrio";
                  return [formatCurrency(Number(value ?? 0)), label];
                }}
                labelFormatter={(day) => `Dia ${day}`}
              />
              <Legend
                formatter={(value) => {
                  if (value === "revenue") return "Receita Acumulada";
                  if (value === "target") return "Ritmo Meta";
                  if (value === "breakEven") return "Ponto Equilíbrio";
                  return value;
                }}
              />
              {/* Break-even line */}
              <ReferenceLine
                y={calc.breakEven}
                stroke="#ef4444"
                strokeDasharray="6 3"
                strokeWidth={1.5}
              />
              {/* Target pace line (dashed) */}
              <Area
                type="monotone"
                dataKey="target"
                stroke="#8b5cf6"
                strokeDasharray="6 3"
                fill="none"
                strokeWidth={1.5}
                dot={false}
              />
              {/* Actual revenue */}
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={calc.aboveBreakEven ? "#22c55e" : "#3b82f6"}
                fill="url(#gradRevenue)"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Margin breakdown — Real vs Planejado */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <CostCard
            label="Invest. Ads"
            realValue={calc.investPercReal}
            planValue={calc.investPctPlan}
            deviation={calc.investDeviation}
            hasReal
          />
          <CostCard
            label="Frete"
            realValue={calc.fretePercReal}
            planValue={calc.fretePctPlan}
            deviation={calc.freteDeviation}
            hasReal={vndaConfigured}
          />
          <CostCard
            label="Descontos"
            realValue={calc.descontoPercReal}
            planValue={calc.descontoPctPlan}
            deviation={calc.descontoDeviation}
            hasReal={vndaConfigured}
          />
          <Link href="/simulador/config" className="bg-muted/30 rounded-lg p-2.5 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-1 mb-0.5">
              <p className="text-muted-foreground">Impostos</p>
              <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold">Config</span>
            </div>
            <p className="font-semibold">{finSettings.tax_pct}%</p>
          </Link>
          <Link href="/simulador/config" className="bg-muted/30 rounded-lg p-2.5 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-1 mb-0.5">
              <p className="text-muted-foreground">CMV</p>
              <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold">Config</span>
            </div>
            <p className="font-semibold">{finSettings.product_cost_pct}%</p>
          </Link>
          <Link href="/simulador/config" className="bg-muted/30 rounded-lg p-2.5 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-1 mb-0.5">
              <p className="text-muted-foreground">Outras</p>
              <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold">Config</span>
            </div>
            <p className="font-semibold">{finSettings.other_expenses_pct}%</p>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Cost Card with deviation ---

function CostCard({
  label,
  realValue,
  planValue,
  deviation,
  hasReal,
}: {
  label: string;
  realValue: number;
  planValue: number;
  deviation: number;
  hasReal: boolean;
}) {
  const threshold = planValue * 0.15; // 15% tolerance
  const isAbove = deviation > threshold;
  const isBelow = deviation < -threshold;

  return (
    <div className="bg-muted/30 rounded-lg p-2.5">
      <div className="flex items-center gap-1 mb-0.5">
        <p className="text-muted-foreground text-xs">{label}</p>
        {hasReal && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-success/10 text-success font-semibold">Real</span>
        )}
      </div>
      <p className="font-semibold text-xs">{hasReal ? realValue.toFixed(1) : planValue.toFixed(1)}%</p>
      {hasReal && (
        <p className={`text-[9px] mt-0.5 ${isAbove ? "text-destructive" : isBelow ? "text-success" : "text-muted-foreground"}`}>
          plan: {planValue}%
          {isAbove && " — acima"}
          {isBelow && " — abaixo"}
        </p>
      )}
    </div>
  );
}

// --- Funnel E-commerce ---

function FunnelSection({
  sessions,
  addToCarts,
  checkouts,
  pedidos,
  ga4Configured,
  loading,
}: {
  sessions: number;
  addToCarts: number;
  checkouts: number;
  pedidos: number;
  ga4Configured: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funil E-commerce</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!ga4Configured) return null;

  const stages = [
    { name: "Visitas", value: sessions, color: "#3b82f6" },
    { name: "Carrinho", value: addToCarts, color: "#8b5cf6" },
    { name: "Checkout", value: checkouts, color: "#f97316" },
    { name: "Compra", value: pedidos, color: "#22c55e" },
  ];

  const maxValue = stages[0].value || 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Funil E-commerce</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.map((stage, i) => {
            const widthPercent = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
            const rateFromPrevious =
              i > 0 && stages[i - 1].value > 0
                ? (stage.value / stages[i - 1].value) * 100
                : i === 0
                  ? 100
                  : 0;
            const rateFromTop =
              maxValue > 0 ? (stage.value / maxValue) * 100 : 0;

            return (
              <div key={stage.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{stage.name}</span>
                    {i > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {rateFromPrevious.toFixed(1)}% da etapa anterior
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{formatNumber(stage.value)}</span>
                    <span className="text-xs text-muted-foreground w-14 text-right">
                      {rateFromTop.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="h-8 rounded bg-muted/30 overflow-hidden flex items-center">
                  <div
                    className="h-full rounded transition-all duration-500 flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max(widthPercent, 2)}%`,
                      backgroundColor: stage.color,
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* Conversion arrows */}
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {stages.slice(1).map((stage, i) => {
            const rate =
              stages[i].value > 0
                ? (stage.value / stages[i].value) * 100
                : 0;
            return (
              <div key={stage.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>{stages[i].name}</span>
                <span className="text-foreground font-medium">{rate.toFixed(1)}%</span>
                <span>→</span>
                <span>{stage.name}</span>
                {i < stages.length - 2 && <span className="mx-2">|</span>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// --- ROAS Bar Chart ---

function RoasChart({
  data,
  loading,
}: {
  data: DailyRow[];
  loading: boolean;
}) {
  const chart = useChartTheme();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ROAS Diário</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ROAS Diário</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis
                dataKey="date"
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}x`}
              />
              <Tooltip
                contentStyle={chart.tooltipStyle}
                formatter={(value) => [
                  `${Number(value ?? 0).toFixed(2)}x`,
                  "ROAS",
                ]}
              />
              <Legend />
              <Bar
                dataKey="roas"
                name="ROAS"
                fill="#8b5cf6"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
