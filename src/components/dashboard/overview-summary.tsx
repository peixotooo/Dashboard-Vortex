"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, Repeat, Trophy, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

interface TopProduct {
  parentSku: string;
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
  variants: number;
}

interface SummaryData {
  configured: boolean;
  topProducts: TopProduct[];
  customers: {
    new: number;
    returning: number;
    prevNew: number;
    prevReturning: number;
  };
  totals: { orders: number; revenue: number };
  period?: { since: string; until: string };
}

const EMPTY: SummaryData = {
  configured: false,
  topProducts: [],
  customers: { new: 0, returning: 0, prevNew: 0, prevReturning: 0 },
  totals: { orders: 0, revenue: 0 },
};

const PRESET_LABEL: Record<DatePreset, string> = {
  today: "hoje",
  yesterday: "ontem",
  last_3d: "últimos 3 dias",
  last_7d: "últimos 7 dias",
  last_14d: "últimos 14 dias",
  last_30d: "últimos 30 dias",
  last_90d: "últimos 90 dias",
  this_month: "este mês",
  last_month: "mês passado",
  custom: "período",
};

function calcChange(current: number, previous: number): number | undefined {
  if (!previous) return undefined;
  return ((current - previous) / previous) * 100;
}

interface Props {
  datePreset: DatePreset;
  customRange?: { since: string; until: string };
}

export function OverviewSummary({ datePreset, customRange }: Props) {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SummaryData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("date_preset", datePreset);
    if (datePreset === "custom" && customRange) {
      params.set("since", customRange.since);
      params.set("until", customRange.until);
    }

    fetch(`/api/crm/overview-summary?${params.toString()}`, {
      headers: { "x-workspace-id": workspace.id },
    })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok) {
          console.warn("[OverviewSummary] HTTP", r.status, json);
        }
        return json as SummaryData | null;
      })
      .then((d) => {
        if (!cancelled) setData(d ?? EMPTY);
      })
      .catch((err) => {
        console.error("[OverviewSummary] fetch failed", err);
        if (!cancelled) setData(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, datePreset, customRange]);

  const periodLabel = PRESET_LABEL[datePreset] || "período";
  const newChange = calcChange(data.customers.new, data.customers.prevNew);
  const returningChange = calcChange(
    data.customers.returning,
    data.customers.prevReturning
  );
  const totalCurrent = data.customers.new + data.customers.returning;
  const totalPrev = data.customers.prevNew + data.customers.prevReturning;
  const newPct = totalCurrent > 0 ? (data.customers.new / totalCurrent) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Customer KPIs (1 col) */}
      <div className="lg:col-span-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
        <CustomerKpi
          title="Novos clientes"
          periodLabel={periodLabel}
          value={data.customers.new}
          change={newChange}
          icon={UserPlus}
          loading={loading}
          accent="text-emerald-400"
          subtitle={
            totalCurrent > 0
              ? `${newPct.toFixed(0)}% do total — ${formatNumber(totalCurrent)} compradores`
              : undefined
          }
        />
        <CustomerKpi
          title="Recorrentes"
          periodLabel={periodLabel}
          value={data.customers.returning}
          change={returningChange}
          icon={Repeat}
          loading={loading}
          accent="text-blue-400"
          subtitle={
            totalPrev > 0
              ? `período anterior: ${formatNumber(totalPrev)}`
              : undefined
          }
        />
      </div>

      {/* Top sellers (2 cols) */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              Mais vendidos · {periodLabel}
            </CardTitle>
            <Link
              href="/crm"
              className="text-xs text-primary hover:underline"
            >
              Ver CRM
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : data.topProducts.length === 0 ? (
            <div className="py-6 text-center space-y-1">
              <p className="text-xs text-muted-foreground">
                Nenhuma venda registrada no período.
              </p>
              <p className="text-[10px] text-muted-foreground">
                Os dados vêm do webhook VNDA. Confira em{" "}
                <Link href="/crm" className="text-primary hover:underline">
                  CRM
                </Link>{" "}
                se a integração está ativa.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-12 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="col-span-6">Produto</span>
                <span className="col-span-2 text-right">Qtd</span>
                <span className="col-span-2 text-right">Pedidos</span>
                <span className="col-span-2 text-right">Receita</span>
              </div>
              {data.topProducts.map((p, i) => (
                <div
                  key={p.parentSku + i}
                  className="grid grid-cols-12 items-center px-2 py-1.5 rounded hover:bg-muted/40 transition-colors"
                >
                  <div className="col-span-6 min-w-0 flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold flex-shrink-0",
                        i === 0
                          ? "bg-amber-500/15 text-amber-400"
                          : i === 1
                            ? "bg-zinc-400/15 text-zinc-300"
                            : i === 2
                              ? "bg-orange-500/15 text-orange-400"
                              : "bg-muted text-muted-foreground"
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {p.parentSku !== "—" && <>SKU pai: {p.parentSku}</>}
                        {p.variants > 1 && (
                          <span className="ml-1">· {p.variants} variantes</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="col-span-2 text-right text-xs font-medium">
                    {formatNumber(p.quantity)}
                  </span>
                  <span className="col-span-2 text-right text-xs text-muted-foreground">
                    {formatNumber(p.orders)}
                  </span>
                  <span className="col-span-2 text-right text-xs font-semibold">
                    {formatCurrency(p.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerKpi({
  title,
  periodLabel,
  value,
  change,
  icon: Icon,
  loading,
  accent,
  subtitle,
}: {
  title: string;
  periodLabel: string;
  value: number;
  change?: number;
  icon: typeof UserPlus;
  loading: boolean;
  accent: string;
  subtitle?: string;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-7 w-20 mb-1.5" />
          <Skeleton className="h-3 w-24" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="hover:border-primary/20 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground truncate">
              {title}
            </p>
            <p className="text-[10px] text-muted-foreground/70 truncate">
              {periodLabel}
            </p>
          </div>
          <div className={cn("rounded-lg bg-muted p-1.5", accent)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <p className="text-2xl font-bold mt-2">{formatNumber(value)}</p>
        <div className="mt-1 flex items-center gap-1 min-h-[16px]">
          {change !== undefined ? (
            <>
              {change >= 0 ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  change >= 0 ? "text-success" : "text-destructive"
                )}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">
                vs per. anterior
              </span>
            </>
          ) : subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
        {change !== undefined && subtitle && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
