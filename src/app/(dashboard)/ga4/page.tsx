"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Users,
  UserPlus,
  Eye,
  ShoppingCart,
  DollarSign,
  Percent,
  Receipt,
  Activity,
  MousePointerClick,
  X,
  CalendarDays,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { DatePreset } from "@/lib/types";

const COLORS = ["#f97316", "#3b82f6", "#22c55e", "#8b5cf6", "#06b6d4", "#ef4444", "#f59e0b", "#ec4899"];
const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

interface GA4Row {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

interface DailyInsight {
  date: string;
  dateRaw: string;
  sessions: number;
  users: number;
  newUsers: number;
  transactions: number;
  revenue: number;
  pageViews: number;
}

interface GA4Totals {
  sessions: number;
  users: number;
  newUsers: number;
  transactions: number;
  revenue: number;
  pageViews: number;
}

export default function GA4Page() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [metaHourly, setMetaHourly] = useState<Array<{ hour: string; spend: number }>>([]);

  // Overview data
  const [totals, setTotals] = useState<GA4Totals>({ sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 });
  const [comparison, setComparison] = useState<GA4Totals | null>(null);
  const [dailyData, setDailyData] = useState<DailyInsight[]>([]);
  const [fullDailyData, setFullDailyData] = useState<DailyInsight[]>([]);

  // Report data
  const [products, setProducts] = useState<GA4Row[]>([]);
  const [regions, setRegions] = useState<GA4Row[]>([]);
  const [hourly, setHourly] = useState<GA4Row[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<GA4Row[]>([]);
  const [traffic, setTraffic] = useState<GA4Row[]>([]);
  const [devices, setDevices] = useState<GA4Row[]>([]);

  // Google Ads data
  const [gadsConfigured, setGadsConfigured] = useState(false);
  const [gadsTotals, setGadsTotals] = useState<{ cost: number; clicks: number; impressions: number; cpc: number; ctr: number }>({ cost: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0 });
  const [gadsDaily, setGadsDaily] = useState<Array<{ date: string; cost: number; clicks: number; impressions: number }>>([]);
  const [gadsCampaigns, setGadsCampaigns] = useState<GA4Row[]>([]);
  const [gadsComparison, setGadsComparison] = useState<{ cost: number; clicks: number; impressions: number; cpc: number; ctr: number } | null>(null);

  // Build report query string (supports day filter)
  const reportQuery = useCallback((reportType: string, limit: number, date?: string | null) => {
    const dateParams = date
      ? `start_date=${date}&end_date=${date}`
      : `date_preset=${datePreset}`;
    return `/api/ga4/report?report_type=${reportType}&${dateParams}&limit=${limit}`;
  }, [datePreset]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all data in parallel
      const metaAccountIds = accountId === "all"
        ? accounts.map((a) => a.id)
        : accountId ? [accountId] : [];

      const dateParams = selectedDate
        ? `start_date=${selectedDate}&end_date=${selectedDate}`
        : `date_preset=${datePreset}`;

      const insightsParams = selectedDate
        ? `start_date=${selectedDate}&end_date=${selectedDate}`
        : `date_preset=${datePreset}&include_comparison=true`;

      const fetches: Promise<Response>[] = [
        fetch(`/api/ga4/insights?${insightsParams}`),
        fetch(reportQuery("products", 20, selectedDate)),
        fetch(reportQuery("regions", 20, selectedDate)),
        fetch(reportQuery("hourly", 24, selectedDate)),
        fetch(reportQuery("day_of_week", 7, selectedDate)),
        fetch(reportQuery("traffic", 20, selectedDate)),
        fetch(reportQuery("devices", 10, selectedDate)),
        fetch(reportQuery("google_ads_campaigns", 20, selectedDate)),
      ];

      // Fetch Meta hourly data if Meta is configured
      if (metaAccountIds.length > 0) {
        for (const id of metaAccountIds) {
          fetches.push(
            fetch(`/api/insights?object_id=${id}&level=account&${dateParams}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&time_increment=all_days`)
          );
        }
      }

      const [insightsRes, ...rest] = await Promise.all(fetches);

      const insightsData = await insightsRes.json();
      const reportJsons = await Promise.all(rest.slice(0, 7).map((r) => r.json()));
      const [productsData, regionsData, hourlyData, dowData, trafficData, devicesData, gadsCampaignsData] = reportJsons;

      // Process Meta hourly data
      const metaHourlyResults = rest.slice(7);
      if (metaHourlyResults.length > 0) {
        const hourlySpendMap = new Map<string, number>();
        for (const res of metaHourlyResults) {
          const data = await res.json();
          const insights = data.insights || [];
          for (const row of insights) {
            const hourRange = row.hourly_stats_aggregated_by_advertiser_time_zone as string || "";
            const hour = hourRange.split(":")[0]?.padStart(2, "0") || "";
            const spend = parseFloat((row.spend as string) || "0");
            hourlySpendMap.set(hour, (hourlySpendMap.get(hour) || 0) + spend);
          }
        }
        setMetaHourly(
          [...hourlySpendMap.entries()]
            .map(([hour, spend]) => ({ hour, spend: parseFloat(spend.toFixed(2)) }))
            .sort((a, b) => a.hour.localeCompare(b.hour))
        );
      } else {
        setMetaHourly([]);
      }

      setConfigured(insightsData.configured !== false);
      setTotals(insightsData.totals || { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 });
      setComparison(insightsData.comparison || null);
      setDailyData(insightsData.insights || []);
      // Keep full daily data for the table when not filtering by day
      if (!selectedDate) {
        setFullDailyData(insightsData.insights || []);
      }
      setProducts(productsData.rows || []);
      setRegions(regionsData.rows || []);
      setHourly(
        [...(hourlyData.rows || [])].sort((a: GA4Row, b: GA4Row) =>
          parseInt(a.dimensions.hour || "0", 10) - parseInt(b.dimensions.hour || "0", 10)
        )
      );
      setDayOfWeek(
        [...(dowData.rows || [])].sort((a: GA4Row, b: GA4Row) =>
          parseInt(a.dimensions.dayOfWeek || "0", 10) - parseInt(b.dimensions.dayOfWeek || "0", 10)
        )
      );
      setTraffic(trafficData.rows || []);
      setDevices(devicesData.rows || []);

      // Google Ads data
      const gAds = insightsData.googleAds;
      setGadsConfigured(gAds != null);
      setGadsTotals(gAds?.totals || { cost: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0 });
      setGadsDaily(gAds?.daily || []);
      setGadsCampaigns(gadsCampaignsData.rows || []);
      setGadsComparison(insightsData.googleAdsComparison || null);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [datePreset, selectedDate, accountId, accounts, reportQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function calcChange(current: number, previous: number | undefined): number | undefined {
    if (previous === undefined || previous === 0) return undefined;
    return ((current - previous) / previous) * 100;
  }

  const txConversao = totals.sessions > 0 ? (totals.transactions / totals.sessions) * 100 : 0;
  const ticketMedio = totals.transactions > 0 ? totals.revenue / totals.transactions : 0;
  const prevTxConversao = comparison && comparison.sessions > 0 ? (comparison.transactions / comparison.sessions) * 100 : undefined;
  const prevTicketMedio = comparison && comparison.transactions > 0 ? comparison.revenue / comparison.transactions : undefined;

  // Merge GA4 hourly + Meta hourly for combined view
  const mergedHourly = useMemo(() => {
    const metaMap = new Map(metaHourly.map((m) => [m.hour, m.spend]));
    return hourly.map((r) => {
      const hour = r.dimensions.hour?.padStart(2, "0") || "00";
      const sessions = r.metrics.sessions || 0;
      const transactions = r.metrics.transactions || 0;
      const revenue = parseFloat((r.metrics.purchaseRevenue || 0).toFixed(2));
      const spend = metaMap.get(hour) || 0;
      return {
        hora: `${hour}h`,
        sessoes: sessions,
        pedidos: transactions,
        receita: revenue,
        txConv: sessions > 0 ? parseFloat(((transactions / sessions) * 100).toFixed(2)) : 0,
        investMeta: parseFloat(spend.toFixed(2)),
        roas: spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
      };
    });
  }, [hourly, metaHourly]);

  if (!configured && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">Google Analytics não configurado</p>
          <p className="text-sm text-muted-foreground">
            Configure GA4_PROPERTY_ID e GA4_CREDENTIALS_JSON nas variáveis de ambiente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Google Analytics</h1>
          <p className="text-sm text-muted-foreground">Dados do GA4 — e-commerce, tráfego e comportamento</p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard title="Sessões" value={formatNumber(totals.sessions)} change={calcChange(totals.sessions, comparison?.sessions)} icon={Activity} iconColor="text-orange-400" loading={loading} />
        <KpiCard title="Usuários" value={formatNumber(totals.users)} change={calcChange(totals.users, comparison?.users)} icon={Users} iconColor="text-blue-400" loading={loading} />
        <KpiCard title="Novos" value={formatNumber(totals.newUsers)} change={calcChange(totals.newUsers, comparison?.newUsers)} icon={UserPlus} iconColor="text-cyan-400" loading={loading} />
        <KpiCard title="Pageviews" value={formatNumber(totals.pageViews)} change={calcChange(totals.pageViews, comparison?.pageViews)} icon={Eye} iconColor="text-purple-400" loading={loading} />
        <KpiCard title="Pedidos" value={formatNumber(totals.transactions)} change={calcChange(totals.transactions, comparison?.transactions)} icon={ShoppingCart} iconColor="text-warning" loading={loading} />
        <KpiCard title="Receita" value={formatCurrency(totals.revenue)} change={calcChange(totals.revenue, comparison?.revenue)} icon={DollarSign} iconColor="text-success" loading={loading} />
        <KpiCard title="TX Conv." value={formatPercent(txConversao)} change={calcChange(txConversao, prevTxConversao)} icon={Percent} iconColor="text-orange-400" loading={loading} />
        <KpiCard title="Ticket" value={formatCurrency(ticketMedio)} change={calcChange(ticketMedio, prevTicketMedio)} icon={Receipt} iconColor="text-emerald-400" loading={loading} />
      </div>

      {/* Day filter badge */}
      {selectedDate && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
            <CalendarDays className="h-3.5 w-3.5" />
            Filtrando: {selectedDate.slice(8, 10)}/{selectedDate.slice(5, 7)}/{selectedDate.slice(0, 4)}
            <button onClick={() => setSelectedDate(null)} className="ml-1 hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="regions">Regiões</TabsTrigger>
          <TabsTrigger value="hours">Horários</TabsTrigger>
          <TabsTrigger value="traffic">Tráfego</TabsTrigger>
          <TabsTrigger value="devices">Dispositivos</TabsTrigger>
          {gadsConfigured && <TabsTrigger value="google_ads">Google Ads</TabsTrigger>}
        </TabsList>

        {/* Tab: Visão Geral */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TrendChart
              title="Sessões e Usuários"
              data={dailyData as unknown as Array<Record<string, unknown>>}
              lines={[
                { key: "sessions", label: "Sessões", color: "#f97316" },
                { key: "users", label: "Usuários", color: "#3b82f6" },
              ]}
              loading={loading}
            />
            <TrendChart
              title="Receita e Pedidos"
              data={dailyData as unknown as Array<Record<string, unknown>>}
              lines={[
                { key: "revenue", label: "Receita (R$)", color: "#22c55e" },
                { key: "transactions", label: "Pedidos", color: "#8b5cf6" },
              ]}
              loading={loading}
            />
          </div>
          <PerformanceTable
            title="Resumo Diário — clique em um dia para filtrar"
            columns={[
              { key: "date", label: "Data" },
              { key: "sessions", label: "Sessões", format: "number", align: "right" },
              { key: "users", label: "Usuários", format: "number", align: "right" },
              { key: "transactions", label: "Pedidos", format: "number", align: "right" },
              { key: "revenue", label: "Receita", format: "currency", align: "right" },
              { key: "pageViews", label: "Pageviews", format: "number", align: "right" },
            ]}
            data={[...(fullDailyData.length > 0 ? fullDailyData : dailyData)].reverse().map((row) => {
              const raw = (row as DailyInsight).dateRaw;
              const normalized = raw && raw.length === 8 && !raw.includes("-")
                ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
                : raw;
              return {
                ...row,
                _highlighted: normalized === selectedDate,
              };
            })}
            loading={loading}
            highlightKey="_highlighted"
            onRowClick={(row) => {
              const dateRaw = (row as unknown as DailyInsight).dateRaw;
              if (dateRaw) {
                const normalized = dateRaw.length === 8 && !dateRaw.includes("-")
                  ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
                  : dateRaw;
                setSelectedDate(normalized === selectedDate ? null : normalized);
              }
            }}
          />
        </TabsContent>

        {/* Tab: Produtos */}
        <TabsContent value="products" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PerformanceTable
              title="Top Produtos por Receita"
              columns={[
                { key: "name", label: "Produto" },
                { key: "quantity", label: "Qtd", format: "number", align: "right" },
                { key: "revenue", label: "Receita", format: "currency", align: "right" },
                { key: "views", label: "Views", format: "number", align: "right" },
                { key: "addToCart", label: "Add Cart", format: "number", align: "right" },
                { key: "txConv", label: "TX Conv.", format: "text", align: "right" },
              ]}
              data={products.map((r) => {
                const views = r.metrics.itemsViewed || 0;
                const purchased = r.metrics.itemsPurchased || 0;
                return {
                  name: r.dimensions.itemName || "(not set)",
                  quantity: purchased,
                  revenue: r.metrics.itemRevenue || 0,
                  views,
                  addToCart: r.metrics.itemsAddedToCart || 0,
                  txConv: views > 0 ? `${((purchased / views) * 100).toFixed(2)}%` : "0%",
                };
              })}
              loading={loading}
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 10 Produtos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={products.slice(0, 10).map((r) => ({
                        name: (r.dimensions.itemName || "").slice(0, 20),
                        receita: parseFloat((r.metrics.itemRevenue || 0).toFixed(2)),
                      }))} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis type="number" stroke="#8888a0" fontSize={12} tickLine={false} />
                        <YAxis type="category" dataKey="name" stroke="#8888a0" fontSize={11} tickLine={false} width={130} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), "Receita"]} />
                        <Bar dataKey="receita" fill="#f97316" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Regiões */}
        <TabsContent value="regions" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PerformanceTable
              title="Performance por Estado"
              columns={[
                { key: "region", label: "Estado" },
                { key: "sessions", label: "Sessões", format: "number", align: "right" },
                { key: "users", label: "Usuários", format: "number", align: "right" },
                { key: "transactions", label: "Pedidos", format: "number", align: "right" },
                { key: "revenue", label: "Receita", format: "currency", align: "right" },
                { key: "txConv", label: "TX Conv.", format: "text", align: "right" },
              ]}
              data={regions.map((r) => {
                const sessions = r.metrics.sessions || 0;
                const transactions = r.metrics.transactions || 0;
                return {
                  region: r.dimensions.region || "(not set)",
                  sessions,
                  users: r.metrics.totalUsers || 0,
                  transactions,
                  revenue: r.metrics.purchaseRevenue || 0,
                  txConv: sessions > 0 ? `${((transactions / sessions) * 100).toFixed(2)}%` : "0%",
                };
              })}
              loading={loading}
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuição por Estado</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={regions.slice(0, 8).map((r) => ({
                            name: r.dimensions.region || "(not set)",
                            value: r.metrics.sessions || 0,
                          }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          label={(p) => `${p.name}: ${((p.percent ?? 0) * 100).toFixed(1)}%`}
                        >
                          {regions.slice(0, 8).map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Horários */}
        <TabsContent value="hours" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sessões por Hora do Dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourly.map((r) => {
                        const sessions = r.metrics.sessions || 0;
                        const transactions = r.metrics.transactions || 0;
                        return {
                          hora: `${r.dimensions.hour?.padStart(2, "0")}h`,
                          sessoes: sessions,
                          receita: parseFloat((r.metrics.purchaseRevenue || 0).toFixed(2)),
                          txConv: sessions > 0 ? parseFloat(((transactions / sessions) * 100).toFixed(2)) : 0,
                        };
                      })}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="hora" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis yAxisId="left" stroke="#8888a0" fontSize={12} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" stroke="#8888a0" fontSize={12} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [name === "TX Conv. (%)" ? `${v}%` : name === "Receita (R$)" ? formatCurrency(Number(v)) : v, name]} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="sessoes" name="Sessões" fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="receita" name="Receita (R$)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="right" dataKey="txConv" name="TX Conv. (%)" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance por Dia da Semana</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dayOfWeek.map((r) => {
                        const idx = parseInt(r.dimensions.dayOfWeek || "0", 10);
                        const sessions = r.metrics.sessions || 0;
                        const transactions = r.metrics.transactions || 0;
                        return {
                          dia: DAY_NAMES[idx] || `Dia ${idx}`,
                          sessoes: sessions,
                          receita: parseFloat((r.metrics.purchaseRevenue || 0).toFixed(2)),
                          txConv: sessions > 0 ? parseFloat(((transactions / sessions) * 100).toFixed(2)) : 0,
                        };
                      })}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="dia" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis yAxisId="left" stroke="#8888a0" fontSize={12} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" stroke="#8888a0" fontSize={12} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [name === "TX Conv. (%)" ? `${v}%` : name === "Receita (R$)" ? formatCurrency(Number(v)) : v, name]} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="sessoes" name="Sessões" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="receita" name="Receita (R$)" fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="right" dataKey="txConv" name="TX Conv. (%)" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Best hour/day insights */}
          {!loading && hourly.length > 0 && dayOfWeek.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Melhor horário (sessões)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const best = [...hourly].sort((a, b) => (b.metrics.sessions || 0) - (a.metrics.sessions || 0))[0];
                      return `${best?.dimensions.hour?.padStart(2, "0")}h — ${formatNumber(best?.metrics.sessions || 0)} sessões`;
                    })()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Melhor horário (conversão)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const withConv = hourly.filter((h) => (h.metrics.sessions || 0) > 0).map((h) => ({
                        hour: h.dimensions.hour,
                        conv: ((h.metrics.transactions || 0) / (h.metrics.sessions || 1)) * 100,
                      }));
                      const best = [...withConv].sort((a, b) => b.conv - a.conv)[0];
                      return best ? `${best.hour?.padStart(2, "0")}h — ${best.conv.toFixed(2)}%` : "—";
                    })()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Melhor dia (receita)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const best = [...dayOfWeek].sort((a, b) => (b.metrics.purchaseRevenue || 0) - (a.metrics.purchaseRevenue || 0))[0];
                      const idx = parseInt(best?.dimensions.dayOfWeek || "0", 10);
                      return `${DAY_NAMES[idx]} — ${formatCurrency(best?.metrics.purchaseRevenue || 0)}`;
                    })()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Melhor dia (conversão)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const withConv = dayOfWeek.filter((d) => (d.metrics.sessions || 0) > 0).map((d) => ({
                        idx: parseInt(d.dimensions.dayOfWeek || "0", 10),
                        conv: ((d.metrics.transactions || 0) / (d.metrics.sessions || 1)) * 100,
                      }));
                      const best = [...withConv].sort((a, b) => b.conv - a.conv)[0];
                      return best ? `${DAY_NAMES[best.idx]} — ${best.conv.toFixed(2)}%` : "—";
                    })()}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Meta Investment x Revenue by Hour */}
          {metaHourly.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Investimento Meta x Receita por Hora</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mergedHourly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="hora" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis stroke="#8888a0" fontSize={12} tickLine={false} tickFormatter={(v) => `R$${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCurrency(Number(v)), name]} />
                        <Legend />
                        <Bar dataKey="investMeta" name="Invest. Meta (R$)" fill="#1877f2" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="receita" name="Receita (R$)" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ROAS insights by hour */}
          {!loading && metaHourly.length > 0 && mergedHourly.some((h) => h.investMeta > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Melhor horário (ROAS)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const withSpend = mergedHourly.filter((h) => h.investMeta > 0);
                      const best = [...withSpend].sort((a, b) => b.roas - a.roas)[0];
                      return best ? `${best.hora} — ${best.roas.toFixed(2)}x (R$${best.investMeta} → R$${best.receita})` : "—";
                    })()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">Pior horário (ROAS)</p>
                  <p className="text-lg font-bold mt-1">
                    {(() => {
                      const withSpend = mergedHourly.filter((h) => h.investMeta > 0);
                      const worst = [...withSpend].sort((a, b) => a.roas - b.roas)[0];
                      return worst ? `${worst.hora} — ${worst.roas.toFixed(2)}x (R$${worst.investMeta} → R$${worst.receita})` : "—";
                    })()}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Hourly Performance Table */}
          <PerformanceTable
            title="Detalhamento por Hora"
            sortable
            columns={[
              { key: "hora", label: "Hora" },
              { key: "sessoes", label: "Sessões", format: "number", align: "right" },
              { key: "pedidos", label: "Pedidos", format: "number", align: "right" },
              { key: "receita", label: "Receita", format: "currency", align: "right" },
              { key: "txConv", label: "TX Conv.", format: "text", align: "right", render: (v) => `${v}%` },
              ...(metaHourly.length > 0 ? [
                { key: "investMeta", label: "Invest. Meta", format: "currency" as const, align: "right" as const },
                { key: "roas", label: "ROAS", format: "text" as const, align: "right" as const, render: (v: unknown) => `${Number(v).toFixed(2)}x` },
              ] : []),
            ]}
            data={mergedHourly}
            loading={loading}
          />
        </TabsContent>

        {/* Tab: Tráfego */}
        <TabsContent value="traffic" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PerformanceTable
              title="Fontes de Tráfego"
              columns={[
                { key: "source", label: "Fonte / Meio" },
                { key: "sessions", label: "Sessões", format: "number", align: "right" },
                { key: "users", label: "Usuários", format: "number", align: "right" },
                { key: "transactions", label: "Pedidos", format: "number", align: "right" },
                { key: "revenue", label: "Receita", format: "currency", align: "right" },
                { key: "txConv", label: "TX Conv.", format: "text", align: "right" },
                { key: "bounce", label: "Bounce", format: "text", align: "right" },
              ]}
              data={traffic.map((r) => {
                const sessions = r.metrics.sessions || 0;
                const transactions = r.metrics.transactions || 0;
                return {
                  source: `${r.dimensions.sessionSource || "(direct)"} / ${r.dimensions.sessionMedium || "(none)"}`,
                  sessions,
                  users: r.metrics.totalUsers || 0,
                  transactions,
                  revenue: r.metrics.purchaseRevenue || 0,
                  txConv: sessions > 0 ? `${((transactions / sessions) * 100).toFixed(2)}%` : "0%",
                  bounce: `${((r.metrics.bounceRate || 0) * 100).toFixed(1)}%`,
                };
              })}
              loading={loading}
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuição por Fonte</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={traffic.slice(0, 8).map((r) => ({
                            name: r.dimensions.sessionSource || "(direct)",
                            value: r.metrics.sessions || 0,
                          }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          label={(p) => `${p.name}: ${((p.percent ?? 0) * 100).toFixed(1)}%`}
                        >
                          {traffic.slice(0, 8).map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Dispositivos */}
        <TabsContent value="devices" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PerformanceTable
              title="Performance por Dispositivo"
              columns={[
                { key: "device", label: "Dispositivo" },
                { key: "sessions", label: "Sessões", format: "number", align: "right" },
                { key: "users", label: "Usuários", format: "number", align: "right" },
                { key: "transactions", label: "Pedidos", format: "number", align: "right" },
                { key: "revenue", label: "Receita", format: "currency", align: "right" },
                { key: "txConv", label: "TX Conv.", format: "text", align: "right" },
                { key: "bounce", label: "Bounce", format: "text", align: "right" },
              ]}
              data={devices.map((r) => {
                const sessions = r.metrics.sessions || 0;
                const transactions = r.metrics.transactions || 0;
                return {
                  device: r.dimensions.deviceCategory || "(not set)",
                  sessions,
                  users: r.metrics.totalUsers || 0,
                  transactions,
                  revenue: r.metrics.purchaseRevenue || 0,
                  txConv: sessions > 0 ? `${((transactions / sessions) * 100).toFixed(2)}%` : "0%",
                  bounce: `${((r.metrics.bounceRate || 0) * 100).toFixed(1)}%`,
                };
              })}
              loading={loading}
            />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuição por Dispositivo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  {loading ? (
                    <div className="h-full animate-pulse rounded bg-muted" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={devices.map((r) => ({
                            name: r.dimensions.deviceCategory || "(not set)",
                            value: r.metrics.sessions || 0,
                          }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          label={(p) => `${p.name}: ${((p.percent ?? 0) * 100).toFixed(1)}%`}
                        >
                          {devices.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Google Ads */}
        {gadsConfigured && (
          <TabsContent value="google_ads" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard title="Investimento" value={`R$ ${gadsTotals.cost.toFixed(2)}`} change={gadsComparison ? ((gadsTotals.cost - gadsComparison.cost) / gadsComparison.cost) * 100 : undefined} icon={DollarSign} iconColor="text-green-400" loading={loading} badge="Google Ads" badgeColor="#4285f4" />
              <KpiCard title="Cliques" value={gadsTotals.clicks.toLocaleString("pt-BR")} change={gadsComparison ? ((gadsTotals.clicks - gadsComparison.clicks) / gadsComparison.clicks) * 100 : undefined} icon={MousePointerClick} iconColor="text-blue-400" loading={loading} />
              <KpiCard title="CPC" value={`R$ ${gadsTotals.cpc.toFixed(2)}`} change={gadsComparison && gadsComparison.cpc > 0 ? ((gadsTotals.cpc - gadsComparison.cpc) / gadsComparison.cpc) * 100 : undefined} icon={Receipt} iconColor="text-orange-400" loading={loading} />
              <KpiCard title="CTR" value={`${gadsTotals.ctr.toFixed(2)}%`} change={gadsComparison && gadsComparison.ctr > 0 ? ((gadsTotals.ctr - gadsComparison.ctr) / gadsComparison.ctr) * 100 : undefined} icon={Percent} iconColor="text-purple-400" loading={loading} />
            </div>

            <TrendChart
              title="Custo Diário Google Ads"
              data={gadsDaily as unknown as Array<Record<string, unknown>>}
              lines={[
                { key: "cost", label: "Custo (R$)", color: "#4285f4" },
              ]}
              loading={loading}
            />

            <PerformanceTable
              title="Campanhas Google Ads"
              columns={[
                { key: "campaign", label: "Campanha" },
                { key: "cost", label: "Custo", format: "currency", align: "right" },
                { key: "clicks", label: "Cliques", format: "number", align: "right" },
                { key: "impressions", label: "Impressões", format: "number", align: "right" },
                { key: "cpc", label: "CPC", format: "currency", align: "right" },
                { key: "ctr", label: "CTR", format: "text", align: "right" },
                { key: "sessions", label: "Sessões", format: "number", align: "right" },
                { key: "transactions", label: "Pedidos", format: "number", align: "right" },
                { key: "revenue", label: "Receita", format: "currency", align: "right" },
                { key: "roas", label: "ROAS", format: "text", align: "right" },
              ]}
              data={gadsCampaigns
                .filter((r) => r.dimensions.sessionGoogleAdsCampaignName && r.dimensions.sessionGoogleAdsCampaignName !== "(not set)")
                .map((r) => {
                  const cost = r.metrics.advertiserAdCost || 0;
                  const clicks = r.metrics.advertiserAdClicks || 0;
                  const impressions = r.metrics.advertiserAdImpressions || 0;
                  const revenue = r.metrics.purchaseRevenue || 0;
                  return {
                    campaign: r.dimensions.sessionGoogleAdsCampaignName,
                    cost,
                    clicks,
                    impressions,
                    cpc: clicks > 0 ? parseFloat((cost / clicks).toFixed(2)) : 0,
                    ctr: impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : "0%",
                    sessions: r.metrics.sessions || 0,
                    transactions: r.metrics.transactions || 0,
                    revenue,
                    roas: cost > 0 ? `${(revenue / cost).toFixed(2)}x` : "—",
                  };
                })
              }
              loading={loading}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
