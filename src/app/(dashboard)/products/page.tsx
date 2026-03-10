"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Package,
  DollarSign,
  Percent,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Search,
  Loader2,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import type { DatePreset } from "@/lib/types";
import type {
  ProductIntelligence,
  ProductComparison,
  ProductClassification,
  ProductRecommendation,
} from "@/lib/products-intelligence";

// --- Constants ---

const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  estrela: "#f59e0b",
  oportunidade: "#3b82f6",
  cash_cow: "#22c55e",
  alerta: "#ef4444",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  estrela: "Estrela",
  oportunidade: "Oportunidade",
  cash_cow: "Cash Cow",
  alerta: "Alerta",
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  aumentar_preco: "Aumentar Preco",
  manter_preco: "Manter Preco",
  reduzir_preco: "Reduzir Preco",
  promocionar: "Promocionar",
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  aumentar_preco: "#22c55e",
  manter_preco: "#8b5cf6",
  reduzir_preco: "#f97316",
  promocionar: "#3b82f6",
};

const RECOMMENDATION_ORDER: ProductRecommendation[] = [
  "promocionar",
  "aumentar_preco",
  "reduzir_preco",
  "manter_preco",
];

// --- Badge components ---

function HealthScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-success"
      : score >= 40
        ? "text-yellow-400"
        : "text-destructive";
  const bg =
    score >= 70
      ? "bg-success/10"
      : score >= 40
        ? "bg-yellow-400/10"
        : "bg-destructive/10";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${color} ${bg}`}
    >
      {score}
    </span>
  );
}

function ClassificationBadge({
  classification,
}: {
  classification: string;
}) {
  const color = CLASSIFICATION_COLORS[classification] || "#8888a0";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ color, backgroundColor: `${color}15` }}
    >
      {CLASSIFICATION_LABELS[classification] || classification}
    </span>
  );
}

function RecommendationBadge({
  recommendation,
}: {
  recommendation: string;
}) {
  const color = RECOMMENDATION_COLORS[recommendation] || "#8888a0";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ color, backgroundColor: `${color}15` }}
    >
      {RECOMMENDATION_LABELS[recommendation] || recommendation}
    </span>
  );
}

// --- Empty summary ---

const emptySummary = {
  totalProducts: 0,
  totalRevenue: 0,
  avgConversionRate: 0,
  productsNeedingAttention: 0,
  classificationCounts: {
    estrela: 0,
    oportunidade: 0,
    cash_cow: 0,
    alerta: 0,
  } as Record<ProductClassification, number>,
  recommendationCounts: {
    aumentar_preco: 0,
    manter_preco: 0,
    reduzir_preco: 0,
    promocionar: 0,
  } as Record<ProductRecommendation, number>,
};

// --- Page ---

export default function ProductsPage() {
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [products, setProducts] = useState<ProductIntelligence[]>([]);
  const [comparison, setComparison] = useState<ProductComparison[] | null>(
    null
  );
  const [summary, setSummary] = useState(emptySummary);
  const [vndaConfigured, setVndaConfigured] = useState(false);
  const [ga4Configured, setGa4Configured] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs: Record<string, string> = {};
      if (workspace?.id) hdrs["x-workspace-id"] = workspace.id;

      const res = await fetch(
        `/api/products/intelligence?date_preset=${datePreset}&include_comparison=true&limit=100`,
        { headers: hdrs }
      );
      const data = await res.json();

      setProducts(data.products || []);
      setComparison(data.comparison || null);
      setSummary(data.summary || emptySummary);
      setVndaConfigured(data.vndaConfigured ?? false);
      setGa4Configured(data.ga4Configured ?? false);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [datePreset, workspace?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filtered products for search
  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const q = searchQuery.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, searchQuery]);

  // Pie chart data
  const classificationPieData = useMemo(() => {
    return (
      Object.entries(summary.classificationCounts) as [string, number][]
    )
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        name: CLASSIFICATION_LABELS[key] || key,
        value: count,
        color: CLASSIFICATION_COLORS[key] || "#8888a0",
      }));
  }, [summary.classificationCounts]);

  // Pareto chart data
  const paretoData = useMemo(() => {
    const sorted = [...products].sort((a, b) => b.revenue - a.revenue);
    const totalRev = sorted.reduce((s, p) => s + p.revenue, 0);
    let cumulative = 0;
    return sorted.slice(0, 20).map((p) => {
      cumulative += p.revenue;
      return {
        name:
          p.name.length > 25 ? p.name.slice(0, 25) + "..." : p.name,
        revenue: p.revenue,
        cumulativePercent:
          totalRev > 0
            ? parseFloat(((cumulative / totalRev) * 100).toFixed(1))
            : 0,
      };
    });
  }, [products]);

  // Not configured
  if (!vndaConfigured && !ga4Configured && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-6">
        <div className="text-center space-y-2">
          <Package className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-lg font-medium">
            Nenhuma fonte de dados configurada
          </p>
          <p className="text-sm text-muted-foreground max-w-md">
            Configure a VNDA em Configuracoes ou o GA4 nas variaveis de
            ambiente para ver a inteligencia de produtos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Inteligencia de Produtos
          </h1>
          <p className="text-muted-foreground text-sm">
            Analise cruzada VNDA + GA4 — classificacao, scoring e
            recomendacoes de preco
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* Partial config warning */}
      {(!vndaConfigured || !ga4Configured) && !loading && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
            <span className="text-sm text-yellow-500">
              {!vndaConfigured
                ? "VNDA nao configurada. Dados de receita e vendas podem estar incompletos."
                : "GA4 nao configurado. Dados de visualizacoes e comportamento nao disponiveis."}
            </span>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visao Geral</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="recommendations">Recomendacoes</TabsTrigger>
          <TabsTrigger value="history">Historico</TabsTrigger>
        </TabsList>

        {/* ===== Tab 1: Overview ===== */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="Total Produtos"
              value={formatNumber(summary.totalProducts)}
              icon={Package}
              iconColor="text-purple-400"
              loading={loading}
            />
            <KpiCard
              title="Receita Total"
              value={formatCurrency(summary.totalRevenue)}
              icon={DollarSign}
              iconColor="text-success"
              loading={loading}
            />
            <KpiCard
              title="TX Conv. Media"
              value={`${summary.avgConversionRate.toFixed(2)}%`}
              icon={Percent}
              iconColor="text-orange-400"
              loading={loading}
            />
            <KpiCard
              title="Precisam Atencao"
              value={formatNumber(summary.productsNeedingAttention)}
              icon={AlertTriangle}
              iconColor="text-destructive"
              loading={loading}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Classification Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Distribuicao por Classificacao
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : classificationPieData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={classificationPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          innerRadius={50}
                          paddingAngle={3}
                          label={({ name, value }) =>
                            `${name} (${value})`
                          }
                          labelLine={{ strokeWidth: 1 }}
                        >
                          {classificationPieData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.color}
                              stroke="transparent"
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pareto Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Analise Pareto de Receita (80/20)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : paretoData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={paretoData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#2a2a3e"
                        />
                        <XAxis
                          dataKey="name"
                          stroke="#8888a0"
                          fontSize={10}
                          tickLine={false}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis
                          yAxisId="left"
                          stroke="#8888a0"
                          fontSize={12}
                          tickFormatter={(v) =>
                            `R$${(v / 1000).toFixed(0)}k`
                          }
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          stroke="#8888a0"
                          fontSize={12}
                          tickFormatter={(v) => `${v}%`}
                          domain={[0, 100]}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                        <ReferenceLine
                          yAxisId="right"
                          y={80}
                          stroke="#f59e0b"
                          strokeDasharray="5 5"
                          label={{ value: "80%", fill: "#f59e0b", fontSize: 11 }}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="revenue"
                          name="Receita"
                          fill="#10b981"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          yAxisId="right"
                          dataKey="cumulativePercent"
                          name="% Acumulado"
                          stroke="#f97316"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== Tab 2: Performance ===== */}
        <TabsContent value="performance" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <PerformanceTable
            title={`Performance de Produtos (${filteredProducts.length})`}
            sortable
            columns={[
              { key: "name", label: "Produto" },
              {
                key: "revenue",
                label: "Receita",
                format: "currency",
                align: "right",
              },
              {
                key: "unitsSold",
                label: "Qtd",
                format: "number",
                align: "right",
              },
              {
                key: "views",
                label: "Views",
                format: "number",
                align: "right",
              },
              {
                key: "addToCarts",
                label: "Add Cart",
                format: "number",
                align: "right",
              },
              {
                key: "conversionRate",
                label: "TX Conv.",
                align: "right",
                render: (v) => `${Number(v).toFixed(2)}%`,
              },
              {
                key: "healthScore",
                label: "Score",
                align: "center",
                render: (v) => (
                  <HealthScoreBadge score={Number(v)} />
                ),
              },
              {
                key: "classification",
                label: "Classe",
                align: "center",
                render: (v) => (
                  <ClassificationBadge
                    classification={String(v)}
                  />
                ),
              },
              {
                key: "recommendation",
                label: "Acao",
                align: "center",
                render: (v) => (
                  <RecommendationBadge
                    recommendation={String(v)}
                  />
                ),
              },
            ]}
            data={filteredProducts as unknown as Record<string, unknown>[]}
            loading={loading}
          />
        </TabsContent>

        {/* ===== Tab 3: Recommendations ===== */}
        <TabsContent value="recommendations" className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            RECOMMENDATION_ORDER.map((rec) => {
              const items = products.filter(
                (p) => p.recommendation === rec
              );
              if (items.length === 0) return null;
              return (
                <Card key={rec}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            RECOMMENDATION_COLORS[rec],
                        }}
                      />
                      <CardTitle className="text-base">
                        {RECOMMENDATION_LABELS[rec]} ({items.length}{" "}
                        produto
                        {items.length > 1 ? "s" : ""})
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {items.map((product) => (
                      <div
                        key={product.name}
                        className="flex items-start justify-between gap-4 p-3 rounded-lg bg-muted/30 border border-border/50"
                      >
                        <div className="space-y-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {product.recommendationReason}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                            <span className="text-xs">
                              Receita:{" "}
                              {formatCurrency(product.revenue)}
                            </span>
                            <span className="text-xs">
                              TX Conv.:{" "}
                              {product.conversionRate.toFixed(2)}%
                            </span>
                            <span className="text-xs">
                              Views:{" "}
                              {formatNumber(product.views)}
                            </span>
                            <span className="text-xs">
                              Score: {product.healthScore}
                            </span>
                          </div>
                        </div>
                        <ClassificationBadge
                          classification={product.classification}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ===== Tab 4: History ===== */}
        <TabsContent value="history" className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !comparison || comparison.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Dados de comparacao nao disponiveis para este periodo.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <TrendingUp className="h-5 w-5 text-success" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Melhorando
                      </p>
                      <p className="text-2xl font-bold text-success">
                        {
                          comparison.filter(
                            (c) => c.trend === "improving"
                          ).length
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Estaveis
                      </p>
                      <p className="text-2xl font-bold">
                        {
                          comparison.filter(
                            (c) => c.trend === "stable"
                          ).length
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <TrendingDown className="h-5 w-5 text-destructive" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Em Queda
                      </p>
                      <p className="text-2xl font-bold text-destructive">
                        {
                          comparison.filter(
                            (c) => c.trend === "declining"
                          ).length
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top gainers and losers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PerformanceTable
                  title="Top Produtos em Alta"
                  columns={[
                    { key: "name", label: "Produto" },
                    {
                      key: "revenueDelta",
                      label: "Receita",
                      align: "right",
                      render: (v) => (
                        <span className="text-success font-medium">
                          +{Number(v).toFixed(1)}%
                        </span>
                      ),
                    },
                    {
                      key: "conversionDelta",
                      label: "Conv.",
                      align: "right",
                      render: (v) => {
                        const n = Number(v);
                        return (
                          <span
                            className={
                              n >= 0
                                ? "text-success"
                                : "text-destructive"
                            }
                          >
                            {n >= 0 ? "+" : ""}
                            {n.toFixed(2)}pp
                          </span>
                        );
                      },
                    },
                  ]}
                  data={
                    comparison
                      .filter((c) => c.trend === "improving")
                      .sort((a, b) => b.revenueDelta - a.revenueDelta)
                      .slice(0, 10) as unknown as Record<
                      string,
                      unknown
                    >[]
                  }
                  loading={loading}
                />
                <PerformanceTable
                  title="Top Produtos em Queda"
                  columns={[
                    { key: "name", label: "Produto" },
                    {
                      key: "revenueDelta",
                      label: "Receita",
                      align: "right",
                      render: (v) => (
                        <span className="text-destructive font-medium">
                          {Number(v).toFixed(1)}%
                        </span>
                      ),
                    },
                    {
                      key: "conversionDelta",
                      label: "Conv.",
                      align: "right",
                      render: (v) => {
                        const n = Number(v);
                        return (
                          <span
                            className={
                              n >= 0
                                ? "text-success"
                                : "text-destructive"
                            }
                          >
                            {n >= 0 ? "+" : ""}
                            {n.toFixed(2)}pp
                          </span>
                        );
                      },
                    },
                  ]}
                  data={
                    comparison
                      .filter((c) => c.trend === "declining")
                      .sort(
                        (a, b) => a.revenueDelta - b.revenueDelta
                      )
                      .slice(0, 10) as unknown as Record<
                      string,
                      unknown
                    >[]
                  }
                  loading={loading}
                />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
