"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Gauge,
  Loader2,
  RefreshCw,
  Target,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

type Status = "ok" | "attention" | "critical";

type DailyRow = {
  date: string;
  label: string;
  revenue: number;
  orders: number;
  ads: number;
  meta_spend: number;
  google_spend: number;
  cash: number;
  sessions: number;
  conversion_rate: number;
  avg_ticket: number;
  mer: number | null;
  source: "vnda" | "crm" | "ga4" | "none";
  is_today: boolean;
};

type Factor = {
  key: string;
  label: string;
  actual: number;
  target: number;
  unit: "currency" | "number" | "percent";
  gap_pct: number;
  status: "ok" | "warning" | "critical";
};

type Action = {
  title: string;
  detail: string;
  tone: "positive" | "warning" | "danger" | "neutral";
};

type PatternRow = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  avg_ticket: number;
};

type CockpitData = {
  period: {
    month: string;
    start: string;
    end: string;
    today: string;
    days_in_month: number;
    current_day: number;
    remaining_days: number;
  };
  sources: {
    revenue: "vnda" | "crm" | "ga4" | "none";
    configured: { vnda: boolean; ga4: boolean; crm: boolean };
    meta_spend: boolean;
    google_spend: boolean;
    ga4: boolean;
  };
  targets: {
    daily_cash_floor: number;
    monthly_cash_floor: number;
    seasonal_revenue_target: number;
  };
  totals: {
    revenue: number;
    ads: number;
    cash: number;
    orders: number;
    sessions: number;
    avg_ticket: number;
    conversion_rate: number;
    mer: number | null;
  };
  today: DailyRow | null;
  daily: DailyRow[];
  diagnosis: {
    status: Status;
    title: string;
    summary: string;
    primary_factor: string;
    factors: Factor[];
    actions: Action[];
    averages: {
      revenue: number;
      ads: number;
      cash: number;
      orders: number;
      sessions: number;
      avg_ticket: number;
      conversion_rate: number;
      mer: number | null;
    };
    requirements: {
      monthly_cash_target: number;
      seasonal_revenue_target: number;
      cash_gap: number;
      seasonal_revenue_gap: number;
      required_cash_per_remaining_day: number;
      required_revenue_per_remaining_day: number;
      effective_revenue_needed_per_day: number;
      suggested_ads_ceiling_per_day: number;
      mer_needed: number | null;
      projected_revenue: number;
      projected_cash: number;
    };
  };
  patterns: {
    window_days: number;
    orders: number;
    confidence: "alta" | "media" | "baixa";
    best_week: PatternRow | null;
    worst_week: PatternRow | null;
    best_weekday: PatternRow | null;
    worst_weekday: PatternRow | null;
    best_hour: PatternRow | null;
    worst_hour: PatternRow | null;
    best_combos: PatternRow[];
  };
};

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function signedCurrency(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCurrency(value)}`;
}

function sourceLabel(source: CockpitData["sources"]["revenue"]) {
  if (source === "vnda") return "VNDA";
  if (source === "crm") return "CRM";
  if (source === "ga4") return "GA4";
  return "Sem fonte";
}

function statusMeta(status: Status) {
  if (status === "ok") {
    return {
      label: "No ritmo",
      icon: CheckCircle2,
      card: "border-emerald-500/30 bg-emerald-500/10",
      text: "text-emerald-500",
    };
  }
  if (status === "attention") {
    return {
      label: "Atencao",
      icon: AlertTriangle,
      card: "border-amber-500/30 bg-amber-500/10",
      text: "text-amber-500",
    };
  }
  return {
    label: "Critico",
    icon: AlertTriangle,
    card: "border-red-500/30 bg-red-500/10",
    text: "text-red-500",
  };
}

function factorValue(factor: Factor, value: number) {
  if (factor.unit === "currency") return formatCurrency(value);
  if (factor.unit === "percent") return `${value.toFixed(2)}%`;
  return formatNumber(Math.round(value));
}

function factorClass(status: Factor["status"]) {
  if (status === "ok") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-500";
  if (status === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-500";
  return "border-red-500/25 bg-red-500/10 text-red-500";
}

function actionClass(tone: Action["tone"]) {
  if (tone === "positive") return "border-emerald-500/25 bg-emerald-500/10";
  if (tone === "warning") return "border-amber-500/25 bg-amber-500/10";
  if (tone === "danger") return "border-red-500/25 bg-red-500/10";
  return "border-border bg-muted/20";
}

function PatternCard({ title, best, worst }: { title: string; best: PatternRow | null; worst: PatternRow | null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Melhor</p>
          <p className="font-semibold">{best?.label || "-"}</p>
          <p className="text-xs text-muted-foreground">{best ? `${formatCurrency(best.revenue)} em ${formatNumber(best.orders)} pedidos` : "Sem volume"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pior com volume</p>
          <p className="font-semibold">{worst?.label || "-"}</p>
          <p className="text-xs text-muted-foreground">{worst ? `${formatCurrency(worst.revenue)} em ${formatNumber(worst.orders)} pedidos` : "Sem volume"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CashCockpitPage() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<CockpitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/financeiro/cockpit-caixa", {
        headers: { "x-workspace-id": workspace.id },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha ao carregar cockpit.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar cockpit.");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const chartData = useMemo(() => {
    return (data?.daily || []).map((row) => ({
      ...row,
      floor: data?.targets.daily_cash_floor ?? 0,
    }));
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Banknote className="h-6 w-6 text-primary" />
            Cockpit de Caixa
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="flex h-96 items-center justify-center rounded-lg bg-muted/30">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Banknote className="h-6 w-6 text-primary" />
            Cockpit de Caixa
          </h1>
          <p className="text-sm text-red-500">{error}</p>
        </div>
        <Button onClick={fetchData} variant="outline">Tentar novamente</Button>
      </div>
    );
  }

  if (!data) return null;

  const meta = statusMeta(data.diagnosis.status);
  const StatusIcon = meta.icon;
  const elapsedCashTarget = data.targets.daily_cash_floor * data.period.current_day;
  const cashBalanceMtd = data.totals.cash - elapsedCashTarget;
  const monthlyCashProgress = data.targets.monthly_cash_floor > 0
    ? Math.min(100, (data.totals.cash / data.targets.monthly_cash_floor) * 100)
    : 0;
  const seasonalProgress = data.targets.seasonal_revenue_target > 0
    ? Math.min(100, (data.totals.revenue / data.targets.seasonal_revenue_target) * 100)
    : 0;
  const todayBalance = data.today ? data.today.cash - data.targets.daily_cash_floor : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Banknote className="h-6 w-6 text-primary" />
            Cockpit de Caixa
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.period.month} · Receita {sourceLabel(data.sources.revenue)} · Meta caixa {formatCurrency(data.targets.daily_cash_floor)}/dia
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/simulador/escala" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
            Escala
          </Link>
          <Link href="/simulador/diagnostico" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
            Diagnostico
          </Link>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className={meta.card}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase tracking-widest ${meta.text}`}>{meta.label}</p>
                <h2 className="mt-2 text-2xl font-black text-foreground">{data.diagnosis.title}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{data.diagnosis.summary}</p>
              </div>
              <StatusIcon className={`h-8 w-8 ${meta.text}`} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Caixa hoje</p>
                <p className={`text-xl font-bold ${todayBalance >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {data.today ? formatCurrency(data.today.cash) : "-"}
                </p>
                <p className="text-xs text-muted-foreground">{signedCurrency(todayBalance)} vs piso</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo acumulado</p>
                <p className={`text-xl font-bold ${cashBalanceMtd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {signedCurrency(cashBalanceMtd)}
                </p>
                <p className="text-xs text-muted-foreground">contra o ritmo ate hoje</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Necessario restante</p>
                <p className="text-xl font-bold text-foreground">
                  {formatCurrency(data.diagnosis.requirements.required_cash_per_remaining_day)}
                </p>
                <p className="text-xs text-muted-foreground">caixa/dia ate fechar o mes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" />
              Acoes recomendadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.diagnosis.actions.map((action) => (
              <div key={action.title} className={`rounded-md border p-3 ${actionClass(action.tone)}`}>
                <p className="text-sm font-semibold text-foreground">{action.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Receita MTD</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(data.totals.revenue)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{seasonalProgress.toFixed(0)}% da meta sazonal</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Ads MTD</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(data.totals.ads)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Meta {formatCurrency(data.daily?.reduce((s, r) => s + r.meta_spend, 0) || 0)} · Google {formatCurrency(data.daily?.reduce((s, r) => s + r.google_spend, 0) || 0)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Caixa MTD</p>
          <p className={`mt-2 text-2xl font-bold ${data.totals.cash >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(data.totals.cash)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{monthlyCashProgress.toFixed(0)}% do piso mensal</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">MER</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{data.totals.mer ? `${data.totals.mer.toFixed(2)}x` : "-"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Receita / ads</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Teto ads/dia</p>
          <p className="mt-2 text-2xl font-bold text-primary">{formatCurrency(data.diagnosis.requirements.suggested_ads_ceiling_per_day)}</p>
          <p className="mt-1 text-xs text-muted-foreground">para proteger caixa no ritmo atual</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Onde apertar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.diagnosis.factors.map((factor) => {
              const GapIcon = factor.gap_pct >= 0 ? ArrowUpRight : ArrowDownRight;
              return (
                <div key={factor.key} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-semibold">{factor.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Atual {factorValue(factor, factor.actual)} · Necessario {factorValue(factor, factor.target)}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold ${factorClass(factor.status)}`}>
                    <GapIcon className="h-3 w-3" />
                    {factor.gap_pct >= 0 ? "+" : ""}{factor.gap_pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Caixa diario</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as DailyRow;
                      return (
                        <div className="rounded-md border border-border bg-background p-3 text-xs shadow-lg">
                          <p className="font-semibold">{row.label}{row.is_today ? " · hoje parcial" : ""}</p>
                          <p>Receita: {formatCurrency(row.revenue)}</p>
                          <p>Ads: {formatCurrency(row.ads)}</p>
                          <p>Caixa: {formatCurrency(row.cash)}</p>
                          <p>Pedidos: {formatNumber(row.orders)}</p>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={data.targets.daily_cash_floor} stroke="#22c55e" strokeDasharray="6 4" />
                  <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ads" name="Ads" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="cash" name="Caixa" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            Historico de comportamento
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ultimos {data.patterns.window_days} dias · {formatNumber(data.patterns.orders)} pedidos · confianca {data.patterns.confidence}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <PatternCard title="Semana do mes" best={data.patterns.best_week} worst={data.patterns.worst_week} />
            <PatternCard title="Dia da semana" best={data.patterns.best_weekday} worst={data.patterns.worst_weekday} />
            <PatternCard title="Horario" best={data.patterns.best_hour} worst={data.patterns.worst_hour} />
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Melhores combinacoes</th>
                  <th className="px-3 py-2 text-right">Receita</th>
                  <th className="px-3 py-2 text-right">Pedidos</th>
                  <th className="px-3 py-2 text-right">Ticket</th>
                </tr>
              </thead>
              <tbody>
                {data.patterns.best_combos.map((row) => (
                  <tr key={row.key} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.revenue)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.orders)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.avg_ticket)}</td>
                  </tr>
                ))}
                {data.patterns.best_combos.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>Sem volume suficiente.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            Controle diario
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-right">Receita</th>
                <th className="px-3 py-2 text-right">Ads</th>
                <th className="px-3 py-2 text-right">Caixa</th>
                <th className="px-3 py-2 text-right">Saldo piso</th>
                <th className="px-3 py-2 text-right">Pedidos</th>
                <th className="px-3 py-2 text-right">Conv.</th>
                <th className="px-3 py-2 text-right">Ticket</th>
                <th className="px-3 py-2 text-right">MER</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((row) => {
                const balance = row.cash - data.targets.daily_cash_floor;
                return (
                  <tr key={row.date} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.label}{row.is_today ? " · hoje" : ""}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.revenue)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.ads)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${row.cash >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(row.cash)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${balance >= 0 ? "text-emerald-500" : "text-red-500"}`}>{signedCurrency(balance)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.orders)}</td>
                    <td className="px-3 py-2 text-right">{row.conversion_rate.toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.avg_ticket)}</td>
                    <td className="px-3 py-2 text-right">{row.mer ? `${row.mer.toFixed(2)}x` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
