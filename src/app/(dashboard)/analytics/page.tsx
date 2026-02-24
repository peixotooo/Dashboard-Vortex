"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { useAccount } from "@/lib/account-context";
import type { DatePreset, BreakdownType, InsightMetrics } from "@/lib/types";

const COLORS = ["#1877f2", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

const breakdownOptions: { value: BreakdownType; label: string }[] = [
  { value: "age", label: "Idade" },
  { value: "gender", label: "Gênero" },
  { value: "placement", label: "Posicionamento" },
  { value: "device_platform", label: "Dispositivo" },
  { value: "country", label: "País" },
];

const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

export default function AnalyticsPage() {
  const { accountId } = useAccount();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [breakdown, setBreakdown] = useState<BreakdownType>("age");
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<InsightMetrics[]>([]);
  const [breakdownData, setBreakdownData] = useState<
    Array<Record<string, unknown>>
  >([]);

  const fetchInsights = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [trendRes, breakdownRes] = await Promise.all([
        fetch(
          `/api/insights?object_id=${accountId}&level=account&date_preset=${datePreset}&fields=impressions,clicks,spend,ctr,cpc`
        ),
        fetch(
          `/api/insights?object_id=${accountId}&level=account&date_preset=${datePreset}&breakdowns=${breakdown}&fields=impressions,clicks,spend`
        ),
      ]);

      const trendData = await trendRes.json();
      const bdData = await breakdownRes.json();

      setInsights(trendData.insights || []);

      // Aggregate breakdown data
      const bdInsights: InsightMetrics[] = bdData.insights || [];
      const aggregated: Record<string, { impressions: number; clicks: number; spend: number }> = {};

      bdInsights.forEach((row) => {
        const key =
          (row as unknown as Record<string, string>)[breakdown] || "Outros";
        if (!aggregated[key]) {
          aggregated[key] = { impressions: 0, clicks: 0, spend: 0 };
        }
        aggregated[key].impressions += parseFloat(row.impressions || "0");
        aggregated[key].clicks += parseFloat(row.clicks || "0");
        aggregated[key].spend += parseFloat(row.spend || "0");
      });

      setBreakdownData(
        Object.entries(aggregated).map(([name, values]) => ({
          name,
          ...values,
          spend: parseFloat(values.spend.toFixed(2)),
        }))
      );
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [datePreset, breakdown, accountId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const trendData = insights.map((row) => ({
    date: row.date_start?.slice(5) || "",
    impressions: parseFloat(row.impressions || "0"),
    clicks: parseFloat(row.clicks || "0"),
    spend: parseFloat(row.spend || "0"),
    ctr: parseFloat(row.ctr || "0"),
  }));

  async function handleExport(format: "csv" | "json") {
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export",
          level: "account",
          date_preset: datePreset,
          format,
        }),
      });
      const data = await res.json();

      const blob = new Blob(
        [format === "json" ? JSON.stringify(data, null, 2) : data.csv || ""],
        { type: format === "json" ? "application/json" : "text/csv" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meta-insights-${datePreset}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Error handling
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Análise detalhada de performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={datePreset} onChange={setDatePreset} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("csv")}
          >
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("json")}
          >
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
        </div>
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Impressões e Cliques"
          data={trendData}
          lines={[
            { key: "impressions", label: "Impressões", color: "#3b82f6" },
            { key: "clicks", label: "Cliques", color: "#22c55e" },
          ]}
          loading={loading}
        />
        <TrendChart
          title="Investimento e CTR"
          data={trendData}
          lines={[
            { key: "spend", label: "Spend (R$)", color: "#f59e0b" },
            { key: "ctr", label: "CTR (%)", color: "#8b5cf6" },
          ]}
          loading={loading}
        />
      </div>

      {/* Breakdown Analysis */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Análise por Breakdown</CardTitle>
            <Select
              value={breakdown}
              onValueChange={(v) => setBreakdown(v as BreakdownType)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {breakdownOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="bar">
            <TabsList className="mb-4">
              <TabsTrigger value="bar">Barras</TabsTrigger>
              <TabsTrigger value="pie">Pizza</TabsTrigger>
            </TabsList>

            <TabsContent value="bar">
              <div className="h-[350px]">
                {loading ? (
                  <div className="h-full animate-pulse rounded bg-muted" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakdownData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                      <XAxis
                        dataKey="name"
                        stroke="#8888a0"
                        fontSize={12}
                        tickLine={false}
                      />
                      <YAxis stroke="#8888a0" fontSize={12} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar
                        dataKey="impressions"
                        name="Impressões"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="clicks"
                        name="Cliques"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </TabsContent>

            <TabsContent value="pie">
              <div className="h-[350px]">
                {loading ? (
                  <div className="h-full animate-pulse rounded bg-muted" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breakdownData}
                        dataKey="spend"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                        label={(props) =>
                          `${props.name ?? ""}: ${(((props.percent as number) ?? 0) * 100).toFixed(1)}%`
                        }
                      >
                        {breakdownData.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
