"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Clock, Sparkles } from "lucide-react";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
type MetricKey = "sessions" | "transactions" | "purchaseRevenue" | "cvr" | "rps";

const METRIC_LABELS: Record<MetricKey, string> = {
  sessions: "Sessoes",
  transactions: "Transacoes",
  purchaseRevenue: "Receita",
  cvr: "CVR",
  rps: "R$/sessao",
};

interface Row {
  dimensions: { dayOfWeek: string; hour: string };
  metrics: { sessions: number; totalUsers: number; transactions: number; purchaseRevenue: number };
}

interface CellValue {
  sessions: number;
  transactions: number;
  revenue: number;
  cvr: number;
  rps: number;
}

function formatValue(v: number, metric: MetricKey): string {
  if (metric === "purchaseRevenue") return `R$ ${v.toFixed(0)}`;
  if (metric === "cvr") return `${v.toFixed(1)}%`;
  if (metric === "rps") return `R$ ${v.toFixed(2)}`;
  return v.toLocaleString("pt-BR");
}

export function BestHoursHeatmap() {
  const [period, setPeriod] = useState("last_90d");
  const [metric, setMetric] = useState<MetricKey>("transactions");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/ga4/report?report_type=best_hours_heatmap&date_preset=${period}&limit=200`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else if (!data.configured) setError("GA4 nao configurado");
        else setRows(data.rows || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  // Build 7×24 grid
  const grid = useMemo(() => {
    const g: CellValue[][] = [];
    for (let d = 0; d < 7; d++) {
      g.push(
        Array.from({ length: 24 }, () => ({
          sessions: 0,
          transactions: 0,
          revenue: 0,
          cvr: 0,
          rps: 0,
        }))
      );
    }
    for (const r of rows) {
      const d = parseInt(r.dimensions.dayOfWeek, 10);
      const h = parseInt(r.dimensions.hour, 10);
      if (!Number.isFinite(d) || !Number.isFinite(h) || d < 0 || d > 6 || h < 0 || h > 23)
        continue;
      const cell = g[d][h];
      cell.sessions = r.metrics.sessions || 0;
      cell.transactions = r.metrics.transactions || 0;
      cell.revenue = r.metrics.purchaseRevenue || 0;
      cell.cvr = cell.sessions > 0 ? (cell.transactions / cell.sessions) * 100 : 0;
      cell.rps = cell.sessions > 0 ? cell.revenue / cell.sessions : 0;
    }
    return g;
  }, [rows]);

  const valueAt = (d: number, h: number): number => {
    const c = grid[d][h];
    if (metric === "sessions") return c.sessions;
    if (metric === "transactions") return c.transactions;
    if (metric === "purchaseRevenue") return c.revenue;
    if (metric === "cvr") return c.cvr;
    return c.rps;
  };

  const max = useMemo(() => {
    let m = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const v = valueAt(d, h);
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [grid, metric]);

  // Top slots overall (across all days) by selected metric
  const topSlots = useMemo(() => {
    const slots: Array<{ day: number; hour: number; value: number; cell: CellValue }> = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        // Filter out cells with too low traffic (< 50 sessions) when ranking by rates
        if ((metric === "cvr" || metric === "rps") && grid[d][h].sessions < 50) continue;
        slots.push({ day: d, hour: h, value: valueAt(d, h), cell: grid[d][h] });
      }
    }
    return slots
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [grid, metric]);

  // Best hour PER DAY (for the table below the heatmap)
  const bestPerDay = useMemo(() => {
    const out: Array<{ day: number; hour: number; cell: CellValue; value: number }> = [];
    for (let d = 0; d < 7; d++) {
      let bestH = 0;
      let bestV = -1;
      for (let h = 0; h < 24; h++) {
        const v = valueAt(d, h);
        if (v > bestV) {
          bestV = v;
          bestH = h;
        }
      }
      out.push({ day: d, hour: bestH, cell: grid[d][bestH], value: bestV });
    }
    return out;
  }, [grid, metric]);

  // Color: green scale based on value/max
  function cellBg(v: number): string {
    if (v <= 0) return "transparent";
    const ratio = Math.min(1, v / max);
    // Use HSL: green hue, opacity by intensity
    const alpha = 0.08 + ratio * 0.85;
    return `rgba(34, 197, 94, ${alpha.toFixed(3)})`;
  }
  function cellTextClass(v: number): string {
    return v / max > 0.55 ? "text-white" : "text-foreground";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Melhores horarios para envio
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Heatmap de {METRIC_LABELS[metric].toLowerCase()} por dia da semana × hora (Google Analytics)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[130px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_30d">Ultimos 30d</SelectItem>
                <SelectItem value="last_60d">Ultimos 60d</SelectItem>
                <SelectItem value="last_90d">Ultimos 90d</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricKey)} className="mt-3">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="transactions" className="text-xs">Transacoes</TabsTrigger>
            <TabsTrigger value="purchaseRevenue" className="text-xs">Receita</TabsTrigger>
            <TabsTrigger value="sessions" className="text-xs">Sessoes</TabsTrigger>
            <TabsTrigger value="cvr" className="text-xs">CVR</TabsTrigger>
            <TabsTrigger value="rps" className="text-xs">R$/sessao</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Heatmap grid */}
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div
                  className="grid gap-px text-[10px]"
                  style={{ gridTemplateColumns: "auto repeat(24, minmax(28px, 1fr))" }}
                >
                  {/* Header row: empty + hours */}
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={`h-${h}`}
                      className="text-center text-muted-foreground font-mono pb-1"
                    >
                      {String(h).padStart(2, "0")}
                    </div>
                  ))}
                  {/* Body rows: day label + 24 cells */}
                  {DAY_LABELS.map((label, d) => (
                    <React.Fragment key={`d-${d}`}>
                      <div className="text-muted-foreground font-medium pr-2 flex items-center justify-end">
                        {label}
                      </div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const v = valueAt(d, h);
                        const cell = grid[d][h];
                        return (
                          <div
                            key={`c-${d}-${h}`}
                            className={`relative aspect-square rounded-sm flex items-center justify-center font-mono text-[9px] leading-none ${cellTextClass(v)} group cursor-default`}
                            style={{ backgroundColor: cellBg(v) }}
                            title={`${DAY_LABELS[d]} ${String(h).padStart(2, "0")}h\nSessoes: ${cell.sessions.toLocaleString("pt-BR")}\nTransacoes: ${cell.transactions}\nReceita: R$ ${cell.revenue.toFixed(2)}\nCVR: ${cell.cvr.toFixed(2)}%\nR$/sessao: ${cell.rps.toFixed(2)}`}
                          >
                            {v > 0 ? formatValue(v, metric).replace("R$ ", "") : ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Recommendation strip */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Top 5 horarios globais
                </div>
                <div className="space-y-1.5">
                  {topSlots.length === 0 && (
                    <div className="text-xs text-muted-foreground">Sem dados suficientes</div>
                  )}
                  {topSlots.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs bg-muted/40 rounded px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-muted-foreground w-4">{i + 1}.</span>
                        <span className="font-medium">
                          {DAY_LABELS[s.day]} {String(s.hour).padStart(2, "0")}h
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {s.cell.transactions} pedidos · CVR {s.cell.cvr.toFixed(2)}%
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatValue(s.value, metric)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Melhor horario por dia
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {bestPerDay.map((s) => (
                    <div
                      key={s.day}
                      className="flex flex-col items-center bg-muted/40 rounded px-1 py-1.5"
                      title={`Sessoes: ${s.cell.sessions.toLocaleString("pt-BR")} · Pedidos: ${s.cell.transactions} · Receita: R$ ${s.cell.revenue.toFixed(2)}`}
                    >
                      <div className="text-[10px] text-muted-foreground">
                        {DAY_LABELS[s.day]}
                      </div>
                      <div className="font-mono font-bold text-sm">
                        {String(s.hour).padStart(2, "0")}h
                      </div>
                      <div className="text-[9px] text-muted-foreground tabular-nums">
                        {s.value > 0 ? formatValue(s.value, metric) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground mt-3">
              Fuso: timezone configurado no GA4. Para ranquear por CVR/R$ por sessao,
              celulas com menos de 50 sessoes sao ignoradas. Passe o mouse em cada celula para detalhes completos.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
