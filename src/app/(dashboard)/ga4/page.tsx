"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Users,
  UserPlus,
  Eye,
  ShoppingCart,
  DollarSign,
  Percent,
  Receipt,
  Activity,
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
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
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
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);

  // Overview data
  const [totals, setTotals] = useState<GA4Totals>({ sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 });
  const [comparison, setComparison] = useState<GA4Totals | null>(null);
  const [dailyData, setDailyData] = useState<DailyInsight[]>([]);

  // Report data
  const [products, setProducts] = useState<GA4Row[]>([]);
  const [regions, setRegions] = useState<GA4Row[]>([]);
  const [hourly, setHourly] = useState<GA4Row[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<GA4Row[]>([]);
  const [traffic, setTraffic] = useState<GA4Row[]>([]);
  const [devices, setDevices] = useState<GA4Row[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [insightsRes, ...reportResults] = await Promise.all([
        fetch(`/api/ga4/insights?date_preset=${datePreset}&include_comparison=true`),
        fetch(`/api/ga4/report?report_type=products&date_preset=${datePreset}&limit=20`),
        fetch(`/api/ga4/report?report_type=regions&date_preset=${datePreset}&limit=20`),
        fetch(`/api/ga4/report?report_type=hourly&date_preset=${datePreset}&limit=24`),
        fetch(`/api/ga4/report?report_type=day_of_week&date_preset=${datePreset}&limit=7`),
        fetch(`/api/ga4/report?report_type=traffic&date_preset=${datePreset}&limit=20`),
        fetch(`/api/ga4/report?report_type=devices&date_preset=${datePreset}&limit=10`),
      ]);

      const insightsData = await insightsRes.json();
      const [productsData, regionsData, hourlyData, dowData, trafficData, devicesData] =
        await Promise.all(reportResults.map((r) => r.json()));

      setConfigured(insightsData.configured !== false);
      setTotals(insightsData.totals || { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 });
      setComparison(insightsData.comparison || null);
      setDailyData(insightsData.insights || []);
      setProducts(productsData.rows || []);
      setRegions(regionsData.rows || []);
      setHourly(hourlyData.rows || []);
      setDayOfWeek(dowData.rows || []);
      setTraffic(trafficData.rows || []);
      setDevices(devicesData.rows || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

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

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="regions">Regiões</TabsTrigger>
          <TabsTrigger value="hours">Horários</TabsTrigger>
          <TabsTrigger value="traffic">Tráfego</TabsTrigger>
          <TabsTrigger value="devices">Dispositivos</TabsTrigger>
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
            title="Resumo Diário"
            columns={[
              { key: "date", label: "Data" },
              { key: "sessions", label: "Sessões", format: "number", align: "right" },
              { key: "users", label: "Usuários", format: "number", align: "right" },
              { key: "transactions", label: "Pedidos", format: "number", align: "right" },
              { key: "revenue", label: "Receita", format: "currency", align: "right" },
              { key: "pageViews", label: "Pageviews", format: "number", align: "right" },
            ]}
            data={[...dailyData].reverse()}
            loading={loading}
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
                          txConv: sessions > 0 ? parseFloat(((transactions / sessions) * 100).toFixed(2)) : 0,
                        };
                      })}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="hora" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis yAxisId="left" stroke="#8888a0" fontSize={12} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" stroke="#8888a0" fontSize={12} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [name === "TX Conv. (%)" ? `${v}%` : v, name]} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="sessoes" name="Sessões" fill="#f97316" radius={[4, 4, 0, 0]} />
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
      </Tabs>
    </div>
  );
}
