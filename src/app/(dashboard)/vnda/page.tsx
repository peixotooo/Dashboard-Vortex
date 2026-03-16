"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ShoppingCart,
  DollarSign,
  Receipt,
  Percent,
  Package,
  Truck,
  Tag,
  TrendingUp,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { useChartTheme } from "@/hooks/use-chart-theme";
import type { DatePreset } from "@/lib/types";

interface VndaDailyRow {
  date: string;
  dateRaw: string;
  orders: number;
  revenue: number;
  subtotal: number;
  discount: number;
  shipping: number;
  avgTicket: number;
  productsSold: number;
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

interface VndaProductRow {
  name: string;
  quantity: number;
  revenue: number;
  avgPrice: number;
  percentOfTotal: number;
}

interface GA4Totals {
  transactions: number;
  revenue: number;
}

export default function VndaPage() {
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);

  const [totals, setTotals] = useState<VndaTotals>({
    orders: 0, revenue: 0, subtotal: 0, discount: 0,
    shipping: 0, avgTicket: 0, productsSold: 0,
  });
  const [comparison, setComparison] = useState<VndaTotals | null>(null);
  const [dailyData, setDailyData] = useState<VndaDailyRow[]>([]);
  const [products, setProducts] = useState<VndaProductRow[]>([]);

  // Comparison data from GA4 and Meta
  const [ga4Totals, setGa4Totals] = useState<GA4Totals | null>(null);
  const [metaTotals, setMetaTotals] = useState<{ purchases: number; revenue: number } | null>(null);
  const [ga4Configured, setGa4Configured] = useState(false);

  const headers: Record<string, string> = {};
  if (workspace?.id) headers["x-workspace-id"] = workspace.id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs: Record<string, string> = {};
      if (workspace?.id) hdrs["x-workspace-id"] = workspace.id;

      const [insightsRes, productsRes, ga4Res] = await Promise.all([
        fetch(`/api/vnda/insights?date_preset=${datePreset}&include_comparison=true`, { headers: hdrs }),
        fetch(`/api/vnda/products?date_preset=${datePreset}&limit=20`, { headers: hdrs }),
        fetch(`/api/ga4/insights?date_preset=${datePreset}`),
      ]);

      const insightsData = await insightsRes.json();
      const productsData = await productsRes.json();
      const ga4Data = await ga4Res.json();

      setConfigured(insightsData.configured !== false);
      setTotals(insightsData.totals || {
        orders: 0, revenue: 0, subtotal: 0, discount: 0,
        shipping: 0, avgTicket: 0, productsSold: 0,
      });
      setComparison(insightsData.comparison || null);
      setDailyData(insightsData.insights || []);
      setProducts(productsData.products || []);

      // GA4 for comparison tab
      if (ga4Data.configured) {
        setGa4Configured(true);
        setGa4Totals({
          transactions: ga4Data.totals?.transactions || 0,
          revenue: ga4Data.totals?.revenue || 0,
        });
      }
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [datePreset, workspace?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function calcChange(current: number, previous: number | undefined): number | undefined {
    if (previous === undefined || previous === 0) return undefined;
    return ((current - previous) / previous) * 100;
  }

  const avgOrdersPerDay = dailyData.length > 0 ? totals.orders / dailyData.length : 0;

  if (!configured && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">VNDA não configurada</p>
          <p className="text-sm text-muted-foreground">
            Configure a conexão VNDA em Configurações → VNDA.
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
          <h1 className="text-2xl font-bold">E-commerce VNDA</h1>
          <p className="text-sm text-muted-foreground">Pedidos confirmados, faturamento e produtos</p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard title="Pedidos" value={formatNumber(totals.orders)} change={calcChange(totals.orders, comparison?.orders)} icon={ShoppingCart} iconColor="text-emerald-400" loading={loading} />
        <KpiCard title="Receita" value={formatCurrency(totals.revenue)} change={calcChange(totals.revenue, comparison?.revenue)} icon={DollarSign} iconColor="text-success" loading={loading} />
        <KpiCard title="Ticket Médio" value={formatCurrency(totals.avgTicket)} change={calcChange(totals.avgTicket, comparison?.avgTicket)} icon={Receipt} iconColor="text-blue-400" loading={loading} />
        <KpiCard title="Subtotal" value={formatCurrency(totals.subtotal)} change={calcChange(totals.subtotal, comparison?.subtotal)} icon={TrendingUp} iconColor="text-purple-400" loading={loading} />
        <KpiCard title="Descontos" value={formatCurrency(totals.discount)} change={calcChange(totals.discount, comparison?.discount)} icon={Tag} iconColor="text-orange-400" loading={loading} />
        <KpiCard title="Frete" value={formatCurrency(totals.shipping)} change={calcChange(totals.shipping, comparison?.shipping)} icon={Truck} iconColor="text-cyan-400" loading={loading} />
        <KpiCard title="Produtos" value={formatNumber(totals.productsSold)} change={calcChange(totals.productsSold, comparison?.productsSold)} icon={Package} iconColor="text-warning" loading={loading} />
        <KpiCard title="Pedidos/Dia" value={avgOrdersPerDay.toFixed(1)} icon={Percent} iconColor="text-pink-400" loading={loading} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="comparison">Comparativo</TabsTrigger>
        </TabsList>

        {/* Tab: Visão Geral */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TrendChart
              title="Receita Diária"
              data={dailyData as unknown as Array<Record<string, unknown>>}
              lines={[
                { key: "revenue", label: "Receita (R$)", color: "#10b981" },
              ]}
              loading={loading}
            />
            <TrendChart
              title="Pedidos Diários"
              data={dailyData as unknown as Array<Record<string, unknown>>}
              lines={[
                { key: "orders", label: "Pedidos", color: "#3b82f6" },
              ]}
              loading={loading}
            />
          </div>

          <TrendChart
            title="Ticket Médio Diário"
            data={dailyData as unknown as Array<Record<string, unknown>>}
            lines={[
              { key: "avgTicket", label: "Ticket Médio (R$)", color: "#8b5cf6" },
            ]}
            loading={loading}
          />

          <PerformanceTable
            title="Resumo Diário"
            columns={[
              { key: "date", label: "Data" },
              { key: "orders", label: "Pedidos", format: "number", align: "right" },
              { key: "revenue", label: "Receita", format: "currency", align: "right" },
              { key: "avgTicket", label: "Ticket Médio", format: "currency", align: "right" },
              { key: "subtotal", label: "Subtotal", format: "currency", align: "right" },
              { key: "discount", label: "Desconto", format: "currency", align: "right" },
              { key: "shipping", label: "Frete", format: "currency", align: "right" },
              { key: "productsSold", label: "Itens", format: "number", align: "right" },
            ]}
            data={[...dailyData].reverse()}
            loading={loading}
          />
        </TabsContent>

        {/* Tab: Produtos */}
        <TabsContent value="products" className="space-y-6">
          <TopProductsChart products={products} loading={loading} />

          <PerformanceTable
            title="Top Produtos por Receita"
            columns={[
              { key: "name", label: "Produto" },
              { key: "quantity", label: "Qtd Vendida", format: "number", align: "right" },
              { key: "revenue", label: "Receita", format: "currency", align: "right" },
              { key: "avgPrice", label: "Preço Médio", format: "currency", align: "right" },
              { key: "percentOfTotal", label: "% do Total", format: "text", align: "right" },
            ]}
            data={products.map((p) => ({ ...p, percentOfTotal: `${p.percentOfTotal}%` }))}
            loading={loading}
          />
        </TabsContent>

        {/* Tab: Comparativo */}
        <TabsContent value="comparison" className="space-y-6">
          <ComparisonSection
            vndaTotals={totals}
            ga4Totals={ga4Totals}
            metaTotals={metaTotals}
            ga4Configured={ga4Configured}
            loading={loading}
          />

          {ga4Configured && ga4Totals && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Insight de Tracking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ga4Totals.transactions > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f97316" }} />
                    <span className="text-sm text-muted-foreground">
                      O GA4 captura ~{totals.orders > 0 ? Math.round((ga4Totals.transactions / totals.orders) * 100) : 0}% dos pedidos reais.
                      {totals.orders > ga4Totals.transactions && (
                        <span className="text-orange-400 ml-1">
                          ({totals.orders - ga4Totals.transactions} pedidos não rastreados)
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#10b981" }} />
                  <span className="text-sm text-muted-foreground">
                    Dados VNDA são pedidos confirmados — fonte definitiva de faturamento.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Top Products Bar Chart ---

function TopProductsChart({
  products,
  loading,
}: {
  products: VndaProductRow[];
  loading: boolean;
}) {
  const chart = useChartTheme();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 Produtos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  const top10 = products.slice(0, 10).map((p) => ({
    name: p.name.length > 25 ? p.name.slice(0, 25) + "…" : p.name,
    revenue: p.revenue,
    quantity: p.quantity,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top 10 Produtos por Receita</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={top10}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 100, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis
                type="number"
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke={chart.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={95}
              />
              <Tooltip
                contentStyle={chart.tooltipStyle}
                formatter={(value) => [`R$ ${Number(value ?? 0).toFixed(2)}`, "Receita"]}
              />
              <Legend />
              <Bar dataKey="revenue" name="Receita" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Comparison Section ---

function ComparisonSection({
  vndaTotals,
  ga4Totals,
  metaTotals,
  ga4Configured,
  loading,
}: {
  vndaTotals: VndaTotals;
  ga4Totals: GA4Totals | null;
  metaTotals: { purchases: number; revenue: number } | null;
  ga4Configured: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-[120px] animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const sources = [
    {
      name: "VNDA",
      color: "#10b981",
      orders: vndaTotals.orders,
      revenue: vndaTotals.revenue,
      label: "Confirmados",
    },
    ...(ga4Configured && ga4Totals
      ? [
          {
            name: "GA4",
            color: "#f97316",
            orders: ga4Totals.transactions,
            revenue: ga4Totals.revenue,
            label: "Rastreados",
          },
        ]
      : []),
    ...(metaTotals
      ? [
          {
            name: "Meta",
            color: "#818cf8",
            orders: metaTotals.purchases,
            revenue: metaTotals.revenue,
            label: "Pixel",
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {sources.map((source) => {
        const orderPct = vndaTotals.orders > 0
          ? Math.round((source.orders / vndaTotals.orders) * 100)
          : 0;
        const revPct = vndaTotals.revenue > 0
          ? Math.round((source.revenue / vndaTotals.revenue) * 100)
          : 0;

        return (
          <Card key={source.name}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: source.color }}
                />
                <span className="font-semibold">{source.name}</span>
                <span className="text-xs text-muted-foreground">({source.label})</span>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Pedidos</p>
                  <p className="text-xl font-bold">{formatNumber(source.orders)}</p>
                  {source.name !== "VNDA" && (
                    <p className="text-xs text-muted-foreground">
                      {orderPct}% do real
                      {vndaTotals.orders > source.orders && (
                        <span className="text-orange-400 ml-1">
                          (-{vndaTotals.orders - source.orders})
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">Receita</p>
                  <p className="text-xl font-bold">{formatCurrency(source.revenue)}</p>
                  {source.name !== "VNDA" && (
                    <p className="text-xs text-muted-foreground">
                      {revPct}% do real
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
