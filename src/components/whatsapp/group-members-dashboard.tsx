"use client";

// Dashboard de crescimento de membros dos grupos de WhatsApp.
// Usado em dois lugares:
//   - página dedicada /whatsapp-groups/membros (com título)
//   - aba "Crescimento" dentro do módulo /whatsapp-groups (sem título)
// Passe `title`/`subtitle` para renderizar o header; omita para a versão embutida.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Users,
  UsersRound,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Settings,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { useChartTheme } from "@/hooks/use-chart-theme";

// ---------- tipos ----------

interface DeltaValue {
  value: number;
  pct: number | null;
}
interface GroupPoint {
  date: string;
  label: string;
  members: number;
  dailyDelta: number | null;
}
type TotalPoint = GroupPoint;
interface GroupRow {
  jid: string;
  name: string;
  memberCount: number;
  adminsCount: number | null;
  capturedOn: string;
  series: GroupPoint[];
  d7: DeltaValue | null;
  d30: DeltaValue | null;
  periodNet: number;
  trend: "up" | "down" | "flat";
}
interface Resp {
  configured: boolean;
  connected: boolean;
  hasData: boolean;
  asOf: string | null;
  totals: {
    memberCount: number;
    groupCount: number;
    asOf: string;
    series: TotalPoint[];
    d1: DeltaValue | null;
    d7: DeltaValue | null;
    d30: DeltaValue | null;
    periodNet: number;
    periodPct: number | null;
    periodDays: number;
  } | null;
  groups: GroupRow[];
}

const RANGES = [
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 ano" },
];

type SortKey = "members" | "d7" | "d30";

// ---------- helpers ----------

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${formatNumber(n)}`;
}
function signedPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function GrowthVerdict({ delta, periodDays }: { delta: DeltaValue | null; periodDays: number }) {
  const value = delta?.value ?? 0;
  const up = value > 0;
  const down = value < 0;
  const tone = up
    ? "border-success/30 bg-success/10 text-success"
    : down
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-border bg-muted text-muted-foreground";
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const word = up ? "Crescendo" : down ? "Caindo" : "Estável";
  const ref = delta ? "nos últimos 7 dias" : `nos últimos ${periodDays} dias`;
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-5 ${tone}`}>
      <Icon className="h-9 w-9 shrink-0" />
      <div>
        <p className="text-xl font-bold leading-tight">{word}</p>
        <p className="text-sm opacity-90">
          {delta
            ? `${signed(delta.value)} membros (${signedPct(delta.pct)}) ${ref}`
            : `Sem variação ${ref}`}
        </p>
      </div>
    </div>
  );
}

function DeltaPill({ delta }: { delta: DeltaValue | null }) {
  if (!delta) return <span className="text-xs text-muted-foreground">—</span>;
  const up = delta.value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm font-medium tabular-nums ${up ? "text-success" : "text-destructive"}`}
    >
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {signed(delta.value)}
    </span>
  );
}

function DeltaKpi({ title, delta }: { title: string; delta: DeltaValue | null }) {
  const up = (delta?.value ?? 0) >= 0;
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {delta ? (
          <>
            <div className="mt-3 flex items-baseline gap-2">
              <span className={`text-2xl font-bold tabular-nums ${up ? "text-success" : "text-destructive"}`}>
                {signed(delta.value)}
              </span>
              {up ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{signedPct(delta.pct)} no período</p>
          </>
        ) : (
          <>
            <p className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">precisa de mais histórico</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ series, color }: { series: GroupPoint[]; color: string }) {
  if (series.length < 2) {
    return <div className="h-8 w-24 text-center text-[10px] text-muted-foreground/60">—</div>;
  }
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <Line type="monotone" dataKey="members" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MoversCard({ title, rows, tone }: { title: string; rows: GroupRow[]; tone: "up" | "down" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum grupo {tone === "up" ? "subindo" : "caindo"}.
          </p>
        ) : (
          rows.map((g) => (
            <div key={g.jid} className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">{g.name}</span>
              <DeltaPill delta={g.d7} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------- componente principal ----------

export function GroupMembersDashboard({
  title,
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  const { workspace } = useWorkspace();
  const chart = useChartTheme();

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [sortKey, setSortKey] = useState<SortKey>("members");
  const abortRef = useRef<AbortController | null>(null);

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (workspace?.id) h["x-workspace-id"] = workspace.id;
    return h;
  }, [workspace?.id]);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp-groups/member-snapshots?days=${days}`, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Erro ${res.status}`);
      }
      setData((await res.json()) as Resp);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [days, headers]);

  useEffect(() => {
    if (workspace?.id) fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData, workspace?.id]);

  const handleCapture = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp-groups/member-snapshot", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Erro ${res.status}`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao capturar");
    } finally {
      setRefreshing(false);
    }
  }, [headers, fetchData]);

  const sortedGroups = useMemo(() => {
    const arr = [...(data?.groups || [])];
    arr.sort((a, b) => {
      if (sortKey === "members") return b.memberCount - a.memberCount;
      if (sortKey === "d7") return (b.d7?.value ?? 0) - (a.d7?.value ?? 0);
      return (b.d30?.value ?? 0) - (a.d30?.value ?? 0);
    });
    return arr;
  }, [data?.groups, sortKey]);

  const movers = useMemo(() => {
    const withD7 = (data?.groups || []).filter((g) => g.d7);
    const up = [...withD7].sort((a, b) => b.d7!.value - a.d7!.value).filter((g) => g.d7!.value > 0).slice(0, 3);
    const down = [...withD7].sort((a, b) => a.d7!.value - b.d7!.value).filter((g) => g.d7!.value < 0).slice(0, 3);
    return { up, down };
  }, [data?.groups]);

  const initialLoading = loading && !data;
  const notConfigured = !initialLoading && data && !data.configured;
  const noData = !initialLoading && data?.configured && !data.hasData;
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      {/* Toolbar (com ou sem título) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {title ? (
          <div className="flex items-center gap-3">
            <UsersRound className="h-7 w-7 text-emerald-500" />
            <div>
              <h1 className="text-2xl font-bold">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Crescimento e queda de membros dos grupos
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {data?.configured && (
            <Button size="sm" variant="outline" onClick={handleCapture} disabled={refreshing} className="gap-1.5">
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Atualizar agora
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {initialLoading && (
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-[300px] w-full" />
        </div>
      )}

      {notConfigured && (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <Settings className="mx-auto h-10 w-10 text-emerald-500" />
            <div>
              <p className="font-medium">W-API não configurada</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Conecte a instância do WhatsApp para começar a monitorar os grupos.
              </p>
            </div>
            <Button asChild className="mx-auto">
              <Link href="/whatsapp-groups">Ir para WhatsApp Grupos</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {noData && (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <UsersRound className="mx-auto h-10 w-10 text-emerald-500" />
            <div>
              <p className="font-medium">Ainda não há histórico de membros</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Capture o primeiro ponto agora. O crescimento aparece a partir do 2º dia —
                depois disso o snapshot diário roda sozinho.
              </p>
            </div>
            <Button onClick={handleCapture} disabled={refreshing} className="mx-auto gap-1.5">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Capturar agora
            </Button>
            <p className="text-xs text-muted-foreground">
              Pode levar mais de 1 minuto se houver muitos grupos.
            </p>
          </CardContent>
        </Card>
      )}

      {!initialLoading && data?.hasData && totals && (
        <>
          <GrowthVerdict delta={totals.d7} periodDays={totals.periodDays} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Total de membros</p>
                  <div className="rounded-lg bg-muted p-2 text-emerald-500">
                    <Users className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums">{formatNumber(totals.memberCount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {signed(totals.periodNet)} ({signedPct(totals.periodPct)}) em {totals.periodDays} dias
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Grupos monitorados</p>
                  <div className="rounded-lg bg-muted p-2 text-emerald-500">
                    <UsersRound className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums">{formatNumber(totals.groupCount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">com snapshot registrado</p>
              </CardContent>
            </Card>

            <DeltaKpi title="Variação 7 dias" delta={totals.d7} />
            <DeltaKpi title="Variação 30 dias" delta={totals.d30} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Total de membros ao longo do tempo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={totals.series} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="waMembers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke={chart.axis}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      domain={["dataMin - 5", "dataMax + 5"]}
                      tickFormatter={(v) => formatNumber(v as number)}
                    />
                    <RTooltip contentStyle={chart.tooltipStyle} formatter={(v) => formatNumber(v as number)} />
                    <Area
                      type="monotone"
                      dataKey="members"
                      name="Membros"
                      stroke="#10b981"
                      fill="url(#waMembers)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ganho / perda diário de membros</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={totals.series.filter((p) => p.dailyDelta != null)}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} width={44} />
                      <RTooltip contentStyle={chart.tooltipStyle} formatter={(v) => signed(v as number)} />
                      <Bar dataKey="dailyDelta" name="Variação" radius={[3, 3, 0, 0]}>
                        {totals.series
                          .filter((p) => p.dailyDelta != null)
                          .map((p, i) => (
                            <Cell key={i} fill={(p.dailyDelta ?? 0) >= 0 ? "#22c55e" : "#ef4444"} />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
              <MoversCard title="Em alta (7d)" rows={movers.up} tone="up" />
              <MoversCard title="Em queda (7d)" rows={movers.down} tone="down" />
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Por grupo ({data.groups.length})</CardTitle>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">Ordenar:</span>
                {(
                  [
                    { k: "members", label: "Membros" },
                    { k: "d7", label: "Cresc. 7d" },
                    { k: "d30", label: "Cresc. 30d" },
                  ] as Array<{ k: SortKey; label: string }>
                ).map((o) => (
                  <button
                    key={o.k}
                    onClick={() => setSortKey(o.k)}
                    className={`rounded-md px-2 py-1 transition-colors ${
                      sortKey === o.k
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Grupo</th>
                      <th className="pb-2 text-right font-medium">Membros</th>
                      <th className="pb-2 text-right font-medium">7 dias</th>
                      <th className="pb-2 text-right font-medium">30 dias</th>
                      <th className="pb-2 pl-4 font-medium">Tendência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroups.map((g) => (
                      <tr key={g.jid} className="border-b last:border-0">
                        <td className="max-w-[260px] py-2.5">
                          <p className="truncate font-medium">{g.name}</p>
                          {g.adminsCount != null && (
                            <p className="text-xs text-muted-foreground">{g.adminsCount} admins</p>
                          )}
                        </td>
                        <td className="py-2.5 text-right font-medium tabular-nums">
                          {formatNumber(g.memberCount)}
                        </td>
                        <td className="py-2.5 text-right">
                          <DeltaPill delta={g.d7} />
                        </td>
                        <td className="py-2.5 text-right">
                          <DeltaPill delta={g.d30} />
                        </td>
                        <td className="py-2.5 pl-4">
                          <Sparkline series={g.series} color={g.trend === "down" ? "#ef4444" : "#10b981"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
