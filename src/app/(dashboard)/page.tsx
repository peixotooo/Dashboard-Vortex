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
import { Badge } from "@/components/ui/badge";
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
  productViewers: number;
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

const OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

interface OverviewCacheEntry {
  savedAt: number;
  data: OverviewData;
}

function readOverviewCache(key: string): OverviewData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverviewCacheEntry;
    if (Date.now() - parsed.savedAt > OVERVIEW_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeOverviewCache(key: string, data: OverviewData) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now(), data } satisfies OverviewCacheEntry)
    );
  } catch {
    // sessionStorage may be unavailable; fetching still works.
  }
}

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
  users: number;
  pageViews: number;
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
  productViewers: number;
  ga4Transactions: number;
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
  const [pendingReviews, setPendingReviews] = useState<{ product: number; store: number; total: number } | null>(null);
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
    users: 0,
    pageViews: 0,
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
    productViewers: 0,
    ga4Transactions: 0,
    trendData: [],
    dailyData: [],
    metaComparison: null,
    ga4Comparison: null,
    vndaComparison: null,
    gadsComparison: null,
    finSettings: FIN_DEFAULTS,
  });
  const accountIdsKey = useMemo(
    () => [...accounts.map((a) => a.id)].sort().join(","),
    [accounts]
  );
  const customRangeKey =
    datePreset === "custom" && customRange
      ? `${customRange.since}:${customRange.until}`
      : "";

  // Avaliações pendentes de moderação (destaque na Overview).
  useEffect(() => {
    if (!workspace?.id) return;
    fetch("/api/reviews/pending-count", { headers: { "x-workspace-id": workspace.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setPendingReviews(d); })
      .catch(() => {});
  }, [workspace?.id]);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }

    const cacheKey = [
      "overview-v2",
      workspace?.id || "",
      accountId,
      accountId === "all" ? accountIdsKey : "",
      datePreset,
      customRangeKey,
    ].join("|");
    const cached = readOverviewCache(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        // Determine which accounts to fetch
        const accountIds = accountId === "all"
          ? accountIdsKey.split(",").filter(Boolean)
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
          productViewers: 0,
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

        const nextData: OverviewData = {
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
          users: ga4Configured ? ga4Totals.users : 0,
          pageViews: ga4Configured ? ga4Totals.pageViews : 0,
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
          productViewers: ga4Configured ? ga4Totals.productViewers : 0,
          ga4Transactions: ga4Configured ? ga4Totals.transactions : 0,
          trendData,
          dailyData,
          metaComparison: aggComparison,
          ga4Comparison: ga4Data.comparison || null,
          vndaComparison: vndaData.comparison || null,
          gadsComparison: ga4Data.googleAdsComparison || null,
          finSettings,
        };

        if (!cancelled) {
          setData(nextData);
          writeOverviewCache(cacheKey, nextData);
        }
      } catch {
        // Keep default empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [datePreset, customRange, customRangeKey, accountId, accountIdsKey, workspace?.id]);

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
  const pendingReviewsHref =
    pendingReviews && pendingReviews.product <= 0 && pendingReviews.store > 0
      ? "/reviews?tab=store&status=pending"
      : "/reviews?tab=moderation&status=pending";

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

      {/* Destaque: avaliações pendentes de moderação */}
      {pendingReviews && pendingReviews.total > 0 && (
        <Link
          href={pendingReviewsHref}
          className="flex items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/50"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white text-sm font-bold">
              {pendingReviews.total}
            </span>
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {pendingReviews.total === 1 ? "1 avaliação aguardando sua aprovação" : `${pendingReviews.total} avaliações aguardando sua aprovação`}
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
                {pendingReviews.product > 0 && `${pendingReviews.product} de produto`}
                {pendingReviews.product > 0 && pendingReviews.store > 0 && " · "}
                {pendingReviews.store > 0 && `${pendingReviews.store} da loja`} — revise e aprove para publicar.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">Revisar agora →</span>
        </Link>
      )}

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

      {/* Resumo: mais vendidos + novos vs recorrentes (segue o período) */}
      <OverviewSummary datePreset={datePreset} customRange={customRange} />

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
        workspaceId={workspace?.id}
        sessions={data.sessions}
        users={data.users}
        pageViews={data.pageViews}
        produtos={data.productViewers}
        addToCarts={data.addToCarts}
        checkouts={data.checkouts}
        finalizados={data.ga4Transactions}
        faturados={data.vndaConfigured ? data.pedidos : null}
        pedidos={data.pedidos}
        revenue={data.revenue}
        ticketMedio={data.ticketMedio}
        roas={data.roas}
        investment={data.totalInvestment}
        previous={{
          users: gc?.users ?? 0,
          pageViews: gc?.pageViews ?? 0,
          sessions: gc?.sessions ?? 0,
          produtos: gc?.productViewers ?? 0,
          addToCarts: gc?.addToCarts ?? 0,
          checkouts: gc?.checkouts ?? 0,
          finalizados: gc?.transactions ?? 0,
          faturados: data.vndaConfigured ? (vc?.orders ?? 0) : null,
          pedidos: prevTxOrders ?? 0,
        }}
        ga4Configured={data.ga4Configured}
        vndaConfigured={data.vndaConfigured}
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

const FASHION_FUNNEL_BENCHMARKS = {
  addToCartRate: 7.12,
  cartToCheckoutRate: 40,
  checkoutCompletionRate: 45,
  fashionCvrGoodBrazil: 1.4,
  fashionCvrExcellentBrazil: 2,
  cartAbandonmentGood: 70.22,
  cartAbandonmentWatch: 77.81,
};

function safeRate(value: number, base: number): number | null {
  if (!base || base <= 0) return null;
  return (value / base) * 100;
}

function formatFunnelRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatPointDelta(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return "sem comparativo";
  const delta = current - previous;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} p.p.`;
}

function benchmarkTone(rate: number | null, benchmark: number) {
  if (rate == null) {
    return {
      label: "sem dado",
      className: "border-border bg-muted text-muted-foreground",
    };
  }
  if (rate >= benchmark) {
    return {
      label: "acima",
      className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (rate >= benchmark * 0.85) {
    return {
      label: "perto",
      className: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    label: "abaixo",
    className: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  };
}

function conversionTone(rate: number | null) {
  if (rate == null) {
    return {
      label: "sem dado",
      className: "border-border bg-muted text-muted-foreground",
    };
  }
  if (rate >= FASHION_FUNNEL_BENCHMARKS.fashionCvrExcellentBrazil) {
    return {
      label: "excelente",
      className: "border-success/20 bg-success/10 text-success",
    };
  }
  if (rate >= FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil) {
    return {
      label: "bom",
      className: "border-success/20 bg-success/10 text-success",
    };
  }
  if (rate >= FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil * 0.85) {
    return {
      label: "perto",
      className: "border-warning/20 bg-warning/10 text-warning",
    };
  }
  return {
    label: "abaixo",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  };
}

function abandonmentTone(rate: number | null) {
  if (rate == null) {
    return {
      label: "sem dado",
      className: "border-border bg-muted text-muted-foreground",
    };
  }
  if (rate <= FASHION_FUNNEL_BENCHMARKS.cartAbandonmentGood) {
    return {
      label: "saudável",
      className: "border-success/20 bg-success/10 text-success",
    };
  }
  if (rate <= FASHION_FUNNEL_BENCHMARKS.cartAbandonmentWatch) {
    return {
      label: "atenção",
      className: "border-warning/20 bg-warning/10 text-warning",
    };
  }
  return {
    label: "crítico",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  };
}

function targetGap(value: number, target: number): number {
  return Math.max(0, Math.round(target - value));
}

const FUNNEL_TARGET_DEFAULTS = {
  produtos: 60,
  carrinho: 12,
  checkout: 45,
  finalizados: 70,
  faturados: 90,
};
type FunnelTargetKey = keyof typeof FUNNEL_TARGET_DEFAULTS;

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// Input de meta (%) com rascunho local: permite limpar/digitar decimais sem
// "pular para 0", commita o número válido na hora (recalcula o Ideal) e
// reverte para o último valor ao sair se o campo ficar vazio.
function TargetInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    // Só re-sincroniza quando o valor externo diverge do que está digitado,
    // preservando estados intermediários como "12." enquanto o usuário digita.
    setDraft((prev) => (parseFloat(prev) === value ? prev : String(value)));
  }, [value]);
  return (
    <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-violet-400">
      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onCommit(clampPct(n));
        }}
        onBlur={() => {
          const n = parseFloat(draft);
          const next = Number.isFinite(n) ? clampPct(n) : value;
          setDraft(String(next));
          onCommit(next);
        }}
        className="w-11 bg-transparent py-1 pl-2 text-right text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={label}
      />
      <span className="pr-1.5 text-xs text-muted-foreground">%</span>
    </div>
  );
}

function volumeDelta(real: number | null, prev: number): number | null {
  if (real == null || !prev || prev <= 0) return null;
  return ((real - prev) / prev) * 100;
}

function FunnelSection({
  workspaceId,
  sessions,
  users,
  pageViews,
  produtos,
  addToCarts,
  checkouts,
  finalizados,
  faturados,
  pedidos,
  revenue,
  ticketMedio,
  roas,
  investment,
  previous,
  ga4Configured,
  vndaConfigured,
  loading,
}: {
  workspaceId?: string;
  sessions: number;
  users: number;
  pageViews: number;
  produtos: number;
  addToCarts: number;
  checkouts: number;
  finalizados: number;
  faturados: number | null;
  pedidos: number;
  revenue: number;
  ticketMedio: number;
  roas: number;
  investment: number;
  previous: {
    users: number;
    pageViews: number;
    sessions: number;
    produtos: number;
    addToCarts: number;
    checkouts: number;
    finalizados: number;
    faturados: number | null;
    pedidos: number;
  };
  ga4Configured: boolean;
  vndaConfigured: boolean;
  loading: boolean;
}) {
  // Metas editáveis do funil Ideal — persistidas por workspace no navegador.
  const storageKey = `funnel-targets:${workspaceId || "default"}`;
  const [targets, setTargets] = useState<Record<FunnelTargetKey, number>>(() => ({
    ...FUNNEL_TARGET_DEFAULTS,
  }));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<FunnelTargetKey, number>>;
        setTargets({ ...FUNNEL_TARGET_DEFAULTS, ...parsed });
      } else {
        setTargets({ ...FUNNEL_TARGET_DEFAULTS });
      }
    } catch {
      setTargets({ ...FUNNEL_TARGET_DEFAULTS });
    }
  }, [storageKey]);

  const updateTarget = (key: FunnelTargetKey, value: number) => {
    setTargets((prev) => {
      const next = { ...prev, [key]: clampPct(value) };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // localStorage indisponível — ajuste segue valendo nesta sessão.
      }
      return next;
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funil de conversões</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!ga4Configured) return null;

  const visitorBase = users > 0 ? users : sessions;
  const previousVisitorBase = previous.users > 0 ? previous.users : previous.sessions;
  const pagesPerUser = visitorBase > 0 ? pageViews / visitorBase : null;
  const previousPagesPerUser =
    previousVisitorBase > 0 ? previous.pageViews / previousVisitorBase : null;

  // Taxas usadas pelos cards de contexto/benchmark (base em sessões/pedidos).
  const addToCartRate = safeRate(addToCarts, sessions);
  const cartToCheckoutRate = safeRate(checkouts, addToCarts);
  const checkoutCompletionRate = safeRate(pedidos, checkouts);
  const siteConversionRate = safeRate(pedidos, sessions);
  const prevSiteConversionRate = safeRate(previous.pedidos, previous.sessions);
  const cartAbandonmentRate =
    addToCarts > 0 ? Math.max(0, (1 - pedidos / addToCarts) * 100) : null;

  const targetOrdersGoodBrazil =
    sessions * (FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil / 100);
  const targetOrdersExcellentBrazil =
    sessions * (FASHION_FUNNEL_BENCHMARKS.fashionCvrExcellentBrazil / 100);
  const ordersToFashionGoodBrazil = targetGap(pedidos, targetOrdersGoodBrazil);
  const ordersToFashionExcellentBrazil = targetGap(pedidos, targetOrdersExcellentBrazil);
  const effectiveTicket = ticketMedio || (pedidos > 0 ? revenue / pedidos : 0);
  const potentialRevenue = ordersToFashionGoodBrazil * effectiveTicket;

  const diagnosticCandidates = [
    {
      label: "Produto/oferta até carrinho",
      rate: addToCartRate,
      benchmark: FASHION_FUNNEL_BENCHMARKS.addToCartRate,
      action: "Revisar PDP, grade/tamanho, preço percebido, frete no PDP e prova social.",
    },
    {
      label: "Carrinho até checkout",
      rate: cartToCheckoutRate,
      benchmark: FASHION_FUNNEL_BENCHMARKS.cartToCheckoutRate,
      action: "Reduzir fricção no carrinho: frete, cupom, parcelamento e CTA de checkout.",
    },
    {
      label: "Checkout até pedido",
      rate: checkoutCompletionRate,
      benchmark: FASHION_FUNNEL_BENCHMARKS.checkoutCompletionRate,
      action: "Atacar custos surpresa, meios de pagamento, erros de formulário e confiança.",
    },
  ].filter((item) => item.rate != null && item.benchmark > 0);

  const mainLeak = diagnosticCandidates
    .map((item) => ({
      ...item,
      score: (item.rate ?? 0) / item.benchmark,
    }))
    .sort((a, b) => a.score - b.score)[0];

  const cvrTone = conversionTone(siteConversionRate);
  const cartAbandonTone = abandonmentTone(cartAbandonmentRate);

  // --- Funil duplo (Realizado vs Ideal) ---
  // O Ideal cascateia a partir das metas (%) de cada transição.
  const idealUsuarios = visitorBase;
  const idealProdutos = idealUsuarios * (targets.produtos / 100);
  const idealCarrinho = idealProdutos * (targets.carrinho / 100);
  const idealCheckout = idealCarrinho * (targets.checkout / 100);
  const idealFinalizados = idealCheckout * (targets.finalizados / 100);
  const idealFaturados = idealFinalizados * (targets.faturados / 100);

  const produtosReal = produtos > 0 ? produtos : null;
  // Finalizados (pedido criado, GA4) deve conter Faturados (pago, VNDA). Como o
  // GA4 costuma subnotificar compras (adblock/consent), usamos o maior dos dois
  // para o funil nunca inverter nem a "Tx. Aprov." passar de 100%.
  const finalizadosVal = Math.max(finalizados, faturados ?? 0);
  const finalizadosPrev = Math.max(previous.finalizados, previous.faturados ?? 0);

  const stageRows: {
    key: string;
    name: string;
    sub: string;
    real: number | null;
    realPrev: number;
    ideal: number;
    rate: number | null;
    prevRate: number | null;
    targetKey: FunnelTargetKey | null;
    targetPct: number | null;
    rateLabel: string | null;
  }[] = [
    {
      key: "usuarios",
      name: "Usuários",
      sub: users > 0 ? `${formatNumber(Math.round(sessions))} sessões` : "base de sessões",
      real: visitorBase,
      realPrev: previousVisitorBase,
      ideal: idealUsuarios,
      rate: null,
      prevRate: null,
      targetKey: null,
      targetPct: null,
      rateLabel: null,
    },
    {
      key: "produtos",
      name: "Produtos",
      sub: "visualização de produto",
      real: produtosReal,
      realPrev: previous.produtos,
      ideal: idealProdutos,
      rate: produtosReal != null ? safeRate(produtosReal, visitorBase) : null,
      prevRate: safeRate(previous.produtos, previousVisitorBase),
      targetKey: "produtos",
      targetPct: targets.produtos,
      rateLabel: "Tx. Vis.",
    },
    {
      key: "carrinho",
      name: "Adição ao Carrinho",
      sub: "produto → carrinho",
      real: addToCarts,
      realPrev: previous.addToCarts,
      ideal: idealCarrinho,
      rate: safeRate(addToCarts, produtos),
      prevRate: safeRate(previous.addToCarts, previous.produtos),
      targetKey: "carrinho",
      targetPct: targets.carrinho,
      rateLabel: "Tx. Adição",
    },
    {
      key: "checkout",
      name: "Checkout",
      sub: "carrinho → checkout",
      real: checkouts,
      realPrev: previous.checkouts,
      ideal: idealCheckout,
      rate: safeRate(checkouts, addToCarts),
      prevRate: safeRate(previous.checkouts, previous.addToCarts),
      targetKey: "checkout",
      targetPct: targets.checkout,
      rateLabel: "Tx. Checkout",
    },
    {
      key: "finalizados",
      name: "Finalizados",
      sub: finalizados > 0 ? "checkout → pedido (GA4)" : "pedido finalizado",
      real: finalizadosVal,
      realPrev: finalizadosPrev,
      ideal: idealFinalizados,
      rate: safeRate(finalizadosVal, checkouts),
      prevRate: safeRate(finalizadosPrev, previous.checkouts),
      targetKey: "finalizados",
      targetPct: targets.finalizados,
      rateLabel: "Tx. Finaliz.",
    },
    {
      key: "faturados",
      name: "Faturados",
      sub: vndaConfigured ? "pedido → faturado (VNDA)" : "sem fonte de faturamento",
      real: faturados,
      realPrev: previous.faturados ?? 0,
      ideal: idealFaturados,
      rate: faturados != null ? safeRate(faturados, finalizadosVal) : null,
      prevRate: previous.faturados != null ? safeRate(previous.faturados, finalizadosPrev) : null,
      targetKey: "faturados",
      targetPct: targets.faturados,
      rateLabel: "Tx. Aprov.",
    },
  ];

  // Projeção do Ideal: receita e ROAS se o funil bater as metas.
  const idealOrdersForRevenue = faturados != null ? idealFaturados : idealFinalizados;
  const idealRevenue = idealOrdersForRevenue * effectiveTicket;
  const idealRoas = investment > 0 ? idealRevenue / investment : null;

  const gridCols = "grid grid-cols-[1.1fr_4.25rem_4.25rem_1.1fr_5.5rem] gap-2";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base">Funil de conversões</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-violet-600 dark:text-violet-400">Realizado</span> vs{" "}
              <span className="font-semibold text-zinc-500 dark:text-zinc-400">Ideal</span> — ajuste as metas (%) por etapa; ficam salvas neste navegador.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
              Brasil CVR bom {FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil.toFixed(1)}% · excelente {FASHION_FUNNEL_BENCHMARKS.fashionCvrExcellentBrazil.toFixed(1)}%
            </Badge>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              Abandono mercado {FASHION_FUNNEL_BENCHMARKS.cartAbandonmentGood.toFixed(0)}–{FASHION_FUNNEL_BENCHMARKS.cartAbandonmentWatch.toFixed(0)}%
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <FunnelMetricTile
            label="CVR site"
            value={formatFunnelRate(siteConversionRate)}
            detail={`vs período anterior: ${formatPointDelta(siteConversionRate, prevSiteConversionRate)}`}
            toneClass={cvrTone.className}
            status={cvrTone.label}
          />
          <FunnelMetricTile
            label="Abandono carrinho"
            value={formatFunnelRate(cartAbandonmentRate)}
            detail="carrinhos que não viraram pedido"
            toneClass={cartAbandonTone.className}
            status={cartAbandonTone.label}
          />
          <FunnelMetricTile
            label="Páginas / usuário"
            value={pagesPerUser == null ? "—" : pagesPerUser.toFixed(1)}
            detail={`vs anterior: ${
              pagesPerUser == null || previousPagesPerUser == null
                ? "sem comparativo"
                : `${pagesPerUser - previousPagesPerUser >= 0 ? "+" : ""}${(pagesPerUser - previousPagesPerUser).toFixed(1)}`
            }`}
            toneClass="border-border bg-muted/40 text-foreground"
            status="engaj."
          />
          <FunnelMetricTile
            label="Receita potencial"
            value={formatCurrency(Math.max(0, potentialRevenue))}
            detail={`se CVR chegar a ${FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil.toFixed(1)}%`}
            toneClass="border-primary/20 bg-primary/10 text-primary"
            status={`${formatNumber(ordersToFashionGoodBrazil)} pedidos`}
          />
        </div>

        {/* Funil duplo: Realizado (roxo) vs Ideal (cinza) com conversões no meio */}
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className={`${gridCols} px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider`}>
              <span className="text-right text-violet-600 dark:text-violet-400">Realizado</span>
              <span className="col-span-2 text-center text-muted-foreground">Conversão</span>
              <span className="text-left text-zinc-500 dark:text-zinc-400">Ideal</span>
              <span className="text-center leading-tight text-muted-foreground">Ajuste manual (%)</span>
            </div>

            <div className="space-y-1.5">
              {stageRows.map((row, index) => {
                const barWidth = 100 - index * 8; // afunilamento decorativo
                const delta = volumeDelta(row.real, row.realPrev);
                const deltaUp = delta != null && delta >= 0;
                const tone =
                  row.rate != null && row.targetPct != null
                    ? benchmarkTone(row.rate, row.targetPct)
                    : null;
                const ratePp =
                  row.rate != null && row.prevRate != null ? row.rate - row.prevRate : null;
                const gapToIdeal =
                  row.real != null && row.ideal - row.real > 0.5
                    ? Math.round(row.ideal - row.real)
                    : null;
                return (
                  <div key={row.key} className={`${gridCols} items-center`}>
                    {/* Realizado (roxo) */}
                    <div className="flex min-w-0 flex-col items-end gap-1">
                      <div
                        className="flex flex-col items-end rounded-md bg-violet-500 px-3 py-1.5 text-right text-white shadow-sm dark:bg-violet-600"
                        style={{ width: `${barWidth}%` }}
                      >
                        <span className="w-full truncate text-[10px] font-medium uppercase tracking-wide text-violet-50/90">
                          {row.name}
                        </span>
                        <span className="text-sm font-bold leading-tight tabular-nums">
                          {row.real == null ? "—" : formatNumber(Math.round(row.real))}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {delta != null && (
                          <span
                            className={`text-[10px] font-semibold tabular-nums ${
                              deltaUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {deltaUp ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                          </span>
                        )}
                        {tone && (
                          <span className={`rounded border px-1 text-[9px] font-semibold ${tone.className}`}>
                            {tone.label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Conversão realizada (teal) + tendência em p.p. vs período anterior */}
                    <div className="flex flex-col items-center justify-center gap-0.5">
                      {row.rateLabel && (
                        <>
                          <div className="flex w-full flex-col items-center justify-center rounded-md bg-teal-500 px-1 py-1.5 text-center text-white dark:bg-teal-600">
                            <span className="text-[8px] font-medium uppercase leading-none text-teal-50/90">
                              {row.rateLabel}
                            </span>
                            <span className="text-xs font-bold leading-tight tabular-nums">
                              {row.rate == null ? "—" : `${row.rate.toFixed(row.rate < 10 ? 1 : 0)}%`}
                            </span>
                          </div>
                          {ratePp != null && (
                            <span
                              className="text-[8px] font-medium tabular-nums text-muted-foreground"
                              title="variação da taxa vs período anterior"
                            >
                              {ratePp >= 0 ? "+" : ""}
                              {ratePp.toFixed(1)}pp
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Conversão ideal/meta (âmbar) */}
                    <div className="flex items-center justify-center">
                      {row.rateLabel && (
                        <div className="flex w-full flex-col items-center justify-center rounded-md bg-amber-100 px-1 py-1.5 text-center dark:bg-amber-900/40">
                          <span className="text-[8px] font-medium uppercase leading-none text-amber-800 dark:text-amber-300">
                            {row.rateLabel}
                          </span>
                          <span className="text-xs font-bold leading-tight tabular-nums text-amber-900 dark:text-amber-100">
                            {row.targetPct}%
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Ideal (cinza) + quanto falta para a meta */}
                    <div className="flex min-w-0 flex-col items-start gap-0.5">
                      <div
                        className="flex flex-col items-start rounded-md bg-zinc-200 px-3 py-1.5 text-left text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100"
                        style={{ width: `${barWidth}%` }}
                      >
                        <span className="w-full truncate text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                          {row.name}
                        </span>
                        <span className="text-sm font-bold leading-tight tabular-nums">
                          {formatNumber(Math.round(row.ideal))}
                        </span>
                      </div>
                      {gapToIdeal != null && (
                        <span
                          className="text-[9px] font-medium tabular-nums text-muted-foreground"
                          title="quanto falta para atingir a meta"
                        >
                          faltam {formatNumber(gapToIdeal)}
                        </span>
                      )}
                    </div>

                    {/* Ajuste manual (%) */}
                    <div className="flex items-center justify-center">
                      {row.targetKey ? (
                        <TargetInput
                          value={row.targetPct ?? 0}
                          onCommit={(v) => updateTarget(row.targetKey!, v)}
                          label={`Meta de conversão para ${row.name} (%)`}
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">base</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rodapé: ROAS / Faturado / TKM (realizado) + projeção ideal */}
            <div className="mt-3 grid grid-cols-5 gap-2 border-t pt-3">
              <FunnelSummaryTile tone="violet" label="ROAS" value={roas > 0 ? `${roas.toFixed(2)}x` : "—"} />
              <FunnelSummaryTile
                tone="violet"
                label="Faturado"
                value={revenue > 0 ? formatCurrency(revenue) : "—"}
              />
              <FunnelSummaryTile
                tone="teal"
                label="TKM"
                value={ticketMedio > 0 ? formatCurrency(ticketMedio) : "—"}
              />
              <FunnelSummaryTile
                tone="gray"
                label="Faturado ideal"
                value={idealRevenue > 0 ? formatCurrency(idealRevenue) : "—"}
              />
              <FunnelSummaryTile
                tone="gray"
                label="ROAS ideal"
                value={idealRoas != null ? `${idealRoas.toFixed(2)}x` : "—"}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Diagnóstico CRO</p>
            <p className="mt-2 text-lg font-semibold">
              {mainLeak ? mainLeak.label : "Sem gargalo claro ainda"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mainLeak
                ? mainLeak.action
                : "Assim que houver volume em todas as etapas, o funil aponta a maior perda relativa."}
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Benchmark moda</p>
            <div className="mt-3 space-y-2 text-sm">
              <BenchmarkLine
                label="Conversão site"
                actual={siteConversionRate}
                benchmark={`bom ${FASHION_FUNNEL_BENCHMARKS.fashionCvrGoodBrazil.toFixed(1)}% · excelente ${FASHION_FUNNEL_BENCHMARKS.fashionCvrExcellentBrazil.toFixed(1)}%`}
              />
              <BenchmarkLine
                label="Add-to-cart"
                actual={addToCartRate}
                benchmark={`${FASHION_FUNNEL_BENCHMARKS.addToCartRate.toFixed(1)}%`}
              />
              <BenchmarkLine
                label="Checkout completion"
                actual={checkoutCompletionRate}
                benchmark={`${FASHION_FUNNEL_BENCHMARKS.checkoutCompletionRate.toFixed(0)}%`}
              />
              <BenchmarkLine
                label="Abandono carrinho"
                actual={cartAbandonmentRate}
                benchmark={`${FASHION_FUNNEL_BENCHMARKS.cartAbandonmentGood.toFixed(0)}–${FASHION_FUNNEL_BENCHMARKS.cartAbandonmentWatch.toFixed(0)}%`}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Referências: IRP Fashion Clothing & Accessories, Dynamic Yield e Baymard. Use como régua de contexto, não como meta cega.
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Pedidos adicionais</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">até CVR bom 1,4%</p>
                <p className="text-xl font-bold tabular-nums">{formatNumber(ordersToFashionGoodBrazil)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">até CVR excelente 2,0%</p>
                <p className="text-xl font-bold tabular-nums">{formatNumber(ordersToFashionExcellentBrazil)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Projeção usa o ticket médio atual e não considera ruptura de estoque ou mix de canal.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelSummaryTile({
  tone,
  label,
  value,
}: {
  tone: "violet" | "teal" | "gray";
  label: string;
  value: string;
}) {
  const toneClass =
    tone === "violet"
      ? "bg-violet-500 text-white dark:bg-violet-600"
      : tone === "teal"
        ? "bg-teal-500 text-white dark:bg-teal-600"
        : "border bg-muted text-foreground";
  const labelClass = tone === "gray" ? "text-muted-foreground" : "text-white/80";
  return (
    <div className={`min-w-0 rounded-md px-2.5 py-2 ${toneClass}`}>
      <p className={`truncate text-[10px] font-medium uppercase tracking-wide ${labelClass}`}>{label}</p>
      <p className="truncate text-sm font-bold leading-tight tabular-nums">{value}</p>
    </div>
  );
}

function FunnelMetricTile({
  label,
  value,
  detail,
  toneClass,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  toneClass: string;
  status: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</p>
        <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold">
          {status}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs opacity-80">{detail}</p>
    </div>
  );
}

function BenchmarkLine({
  label,
  actual,
  benchmark,
}: {
  label: string;
  actual: number | null;
  benchmark: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <strong className="font-semibold">{formatFunnelRate(actual)}</strong>
        <span className="ml-2 text-xs text-muted-foreground">ref. {benchmark}</span>
      </span>
    </div>
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
