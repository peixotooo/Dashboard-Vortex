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

interface DailyRow {
  date: string;
  spend: number;
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

interface OverviewData {
  // Meta
  spend: number;
  cpc: number;
  ctr: number;
  impressions: number;
  clicks: number;
  reach: number;
  // GA4
  revenue: number;
  sessions: number;
  pedidos: number;
  ticketMedio: number;
  txConversao: number;
  roas: number;
  ga4Configured: boolean;
  // Combined
  trendData: DailyRow[];
  dailyData: DailyRow[];
  topCampaigns: Array<Record<string, unknown>>;
  // Comparison
  metaComparison: MetaComparison | null;
  ga4Comparison: GA4Totals | null;
}

export default function OverviewPage() {
  const { accountId } = useAccount();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData>({
    spend: 0,
    cpc: 0,
    ctr: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    revenue: 0,
    sessions: 0,
    pedidos: 0,
    ticketMedio: 0,
    txConversao: 0,
    roas: 0,
    ga4Configured: false,
    trendData: [],
    dailyData: [],
    topCampaigns: [],
    metaComparison: null,
    ga4Comparison: null,
  });

  useEffect(() => {
    if (!accountId) return;

    async function fetchData() {
      setLoading(true);
      try {
        // Fetch Meta + GA4 + Campaigns in parallel
        const [insightsRes, ga4Res, campaignsRes] = await Promise.all([
          fetch(
            `/api/insights?object_id=${accountId}&level=account&date_preset=${datePreset}&include_comparison=true`
          ),
          fetch(
            `/api/ga4/insights?date_preset=${datePreset}&include_comparison=true`
          ),
          fetch(`/api/campaigns?account_id=${accountId}&limit=5`),
        ]);

        const insightsData = await insightsRes.json();
        const ga4Data = await ga4Res.json();
        const campaignsData = await campaignsRes.json();

        // --- Process Meta data ---
        const metaInsights = insightsData.insights || [];
        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalReach = 0;

        interface MetaDailyItem {
          date: string;
          spend: number;
          cpc: number;
          impressions: number;
          clicks: number;
          metaRevenue: number;
          metaPurchases: number;
        }

        let totalMetaRevenue = 0;
        let totalMetaPurchases = 0;

        const metaDaily: MetaDailyItem[] = metaInsights.map(
          (row: Record<string, unknown>) => {
            const spend = parseFloat((row.spend as string) || "0");
            const impressions = parseFloat(
              (row.impressions as string) || "0"
            );
            const clicks = parseFloat((row.clicks as string) || "0");
            const reach = parseFloat((row.reach as string) || "0");
            const cpc = clicks > 0 ? spend / clicks : 0;

            // Extract purchase data from Meta actions/action_values
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

            return {
              date: ((row.date_start as string) || "").slice(8, 10) + "/" + ((row.date_start as string) || "").slice(5, 7),
              spend: parseFloat(spend.toFixed(2)),
              cpc: parseFloat(cpc.toFixed(2)),
              impressions,
              clicks,
              metaRevenue: parseFloat(metaRevenue.toFixed(2)),
              metaPurchases,
            };
          }
        );

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

        // --- Merge daily data (Meta + GA4 by date) ---
        // GA4 has priority for revenue/transactions; Meta is fallback
        const trendData: DailyRow[] = metaDaily.map((metaDay) => {
          const ga4Day = ga4Insights.find((g) => g.date === metaDay.date);
          const revenue = ga4Configured
            ? (ga4Day?.revenue ?? 0)
            : metaDay.metaRevenue;
          const transactions = ga4Configured
            ? (ga4Day?.transactions ?? 0)
            : metaDay.metaPurchases;
          const sessions = ga4Day?.sessions ?? 0;

          return {
            date: metaDay.date,
            spend: metaDay.spend,
            revenue: parseFloat(revenue.toFixed(2)),
            roas:
              metaDay.spend > 0
                ? parseFloat((revenue / metaDay.spend).toFixed(2))
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
            cpc: metaDay.cpc,
            impressions: metaDay.impressions,
            clicks: metaDay.clicks,
          };
        });

        // --- Calculate totals ---
        // Use GA4 data when available, otherwise fall back to Meta purchase data
        const totalRevenue = ga4Configured
          ? ga4Totals.revenue
          : totalMetaRevenue;
        const totalPedidos = ga4Configured
          ? ga4Totals.transactions
          : totalMetaPurchases;
        const totalSessions = ga4Configured
          ? ga4Totals.sessions
          : 0;
        const totalRoas =
          totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const totalTicketMedio =
          totalPedidos > 0 ? totalRevenue / totalPedidos : 0;
        const totalTxConversao =
          totalSessions > 0
            ? (totalPedidos / totalSessions) * 100
            : 0;

        const dailyData = [...trendData].reverse();
        const campaigns = campaignsData.campaigns || [];

        setData({
          spend: totalSpend,
          cpc: totalCpc,
          ctr: totalCtr,
          impressions: totalImpressions,
          clicks: totalClicks,
          reach: totalReach,
          revenue: totalRevenue,
          sessions: totalSessions,
          pedidos: totalPedidos,
          ticketMedio: totalTicketMedio,
          txConversao: totalTxConversao,
          roas: totalRoas,
          ga4Configured,
          trendData,
          dailyData,
          topCampaigns: campaigns,
          metaComparison: insightsData.comparison || null,
          ga4Comparison: ga4Data.comparison || null,
        });
      } catch {
        // Keep default empty state
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [datePreset, accountId]);

  function calcChange(
    current: number,
    previous: number | undefined
  ): number | undefined {
    if (previous === undefined || previous === 0) return undefined;
    return ((current - previous) / previous) * 100;
  }

  const mc = data.metaComparison;
  const gc = data.ga4Comparison;

  // Previous period revenue: GA4 if available, otherwise Meta
  const prevRevenue = data.ga4Configured && gc ? gc.revenue : mc?.revenue;
  const prevPurchases = data.ga4Configured && gc ? gc.transactions : mc?.purchases;

  // Previous period ROAS
  const prevRoas =
    mc && mc.spend > 0 && prevRevenue !== undefined ? prevRevenue / mc.spend : undefined;
  // Previous period ticket médio
  const prevTicketMedio =
    prevPurchases && prevPurchases > 0 && prevRevenue !== undefined
      ? prevRevenue / prevPurchases
      : undefined;
  // Previous period tx conversão
  const prevTxConversao =
    gc && gc.sessions > 0
      ? (gc.transactions / gc.sessions) * 100
      : undefined;

  const revenueSource = data.ga4Configured ? "GA4" : "Meta";
  const revenueColor = data.ga4Configured ? "#f97316" : "#1877f2";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral Meta Ads{data.ga4Configured ? " + GA4" : ""}
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* KPI Cards - Row 1: Revenue metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Investimento"
          value={formatCurrency(data.spend)}
          change={calcChange(data.spend, mc?.spend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          badge="Meta"
          badgeColor="#1877f2"
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
          badge={data.ga4Configured ? "Meta + GA4" : "Meta"}
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

      {/* KPI Cards - Row 2: Performance metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <KpiCard
          title="CPC"
          value={formatCurrency(data.cpc)}
          change={calcChange(data.cpc, mc?.cpc)}
          icon={MousePointerClick}
          iconColor="text-destructive"
          loading={loading}
          badge="Meta"
          badgeColor="#1877f2"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Investimento x Receita"
          data={data.trendData as unknown as Array<Record<string, unknown>>}
          lines={[
            { key: "spend", label: "Investimento (R$)", color: "#22c55e" },
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
      </div>
      <PerformanceTable
        title="Controle Diário"
        columns={[
          { key: "date", label: "Data" },
          { key: "sessions", label: "Sessões", format: "number", align: "right" },
          { key: "pedidos", label: "Pedidos", format: "number", align: "right" },
          { key: "ticketMedio", label: "Ticket Médio", format: "currency", align: "right" },
          { key: "txConversao", label: "TX Conv.", format: "percent", align: "right" },
          { key: "spend", label: "Invest. Meta", format: "currency", align: "right" },
          { key: "revenue", label: "Receita", format: "currency", align: "right" },
          { key: "roas", label: "ROAS", format: "text", align: "right" },
          { key: "cpc", label: "CPC", format: "currency", align: "right" },
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
