"use client";

import React, { useEffect, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  Target,
  ShoppingCart,
  MousePointerClick,
  Users,
  Receipt,
  Percent,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
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
  // Combined
  trendData: DailyRow[];
  dailyData: DailyRow[];
  topCampaigns: Array<Record<string, unknown>>;
  // Comparison
  metaComparison: MetaComparison | null;
  ga4Comparison: GA4Totals | null;
  vndaComparison: VndaTotals | null;
  gadsComparison: GoogleAdsTotals | null;
}

export default function OverviewPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
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
    trendData: [],
    dailyData: [],
    topCampaigns: [],
    metaComparison: null,
    ga4Comparison: null,
    vndaComparison: null,
    gadsComparison: null,
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

        // Fetch Meta (per-account) + GA4 + VNDA in parallel
        const vndaHeaders: Record<string, string> = {};
        if (workspace?.id) vndaHeaders["x-workspace-id"] = workspace.id;

        const [insightsResults, ga4Res, vndaRes, campaignsResults] = await Promise.all([
          // Fetch insights for each account in parallel
          Promise.all(
            accountIds.map((id) =>
              fetch(
                `/api/insights?object_id=${id}&level=account&date_preset=${datePreset}&include_comparison=true`
              ).then((r) => r.json())
            )
          ),
          fetch(
            `/api/ga4/insights?date_preset=${datePreset}&include_comparison=true`
          ),
          fetch(
            `/api/vnda/insights?date_preset=${datePreset}&include_comparison=true`,
            { headers: vndaHeaders }
          ),
          // Fetch campaigns for each account
          Promise.all(
            accountIds.map((id) =>
              fetch(`/api/campaigns?account_id=${id}&limit=5`).then((r) => r.json())
            )
          ),
        ]);

        const ga4Data = await ga4Res.json();
        const vndaData = await vndaRes.json();

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

        const allDates = [...allDatesSet].sort();

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

        // --- Calculate totals ---
        // Priority: VNDA > GA4 > Meta for revenue/orders
        const totalRevenue = vndaConfigured
          ? vndaTotals.revenue
          : ga4Configured
            ? ga4Totals.revenue
            : totalMetaRevenue;
        const totalPedidos = vndaConfigured
          ? vndaTotals.orders
          : ga4Configured
            ? ga4Totals.transactions
            : totalMetaPurchases;
        const totalSessions = ga4Configured
          ? ga4Totals.sessions
          : 0;
        const totalInvestment = totalSpend + gadsTotals.cost;
        const totalRoas =
          totalInvestment > 0 ? totalRevenue / totalInvestment : 0;
        const totalTicketMedio =
          totalPedidos > 0 ? totalRevenue / totalPedidos : 0;
        const totalTxConversao =
          totalSessions > 0
            ? (totalPedidos / totalSessions) * 100
            : 0;

        const dailyData = [...trendData].reverse();
        const campaigns = campaignsResults.flatMap((r) => r.campaigns || []);

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
          trendData,
          dailyData,
          topCampaigns: campaigns,
          metaComparison: aggComparison,
          ga4Comparison: ga4Data.comparison || null,
          vndaComparison: vndaData.comparison || null,
          gadsComparison: ga4Data.googleAdsComparison || null,
        });
      } catch {
        // Keep default empty state
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [datePreset, accountId, accounts, workspace?.id]);

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
  const revenueColor = data.vndaConfigured ? "#10b981" : data.ga4Configured ? "#f97316" : "#1877f2";

  // Investment badge
  const investBadge = data.gadsConfigured ? "Meta + Google" : "Meta";
  const investColor = data.gadsConfigured ? "#8b5cf6" : "#1877f2";

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
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
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
          badgeColor="#1877f2"
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

      {/* Controle Diário */}
      <div className="flex items-center gap-3 -mb-4">
        <span className="text-xs font-medium text-muted-foreground">Fonte:</span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#1877f2" }} />
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

      {/* Top Campaigns */}
      <PerformanceTable
        title="Top Campanhas"
        columns={[
          { key: "name", label: "Nome" },
          { key: "status", label: "Status", format: "status" },
          { key: "objective", label: "Objetivo" },
          {
            key: "daily_budget",
            label: "Orçamento Diário",
            format: "budget",
            align: "right",
          },
        ]}
        data={data.topCampaigns}
        loading={loading}
      />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis
                dataKey="date"
                stroke="#8888a0"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#8888a0"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}x`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#12121a",
                  border: "1px solid #2a2a3e",
                  borderRadius: "8px",
                  color: "#f0f0f5",
                  fontSize: "12px",
                }}
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
