"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, Target, TrendingUp, TrendingDown, Wallet, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { fmtPct, firstDayOfMonth, lastDayOfMonth } from "@/lib/controladoria/format";

type DreLine = { key: string; label: string; op: string; value: number; pct: number | null };
type Dashboard = {
  from: string; to: string;
  dre: DreLine[];
  gastos: { label: string; value: number }[];
  dfcEntradas: number; dfcSaidas: number;
  saldoInicial: number; saldoFinal: number;
  goals: { meta_receita_mensal?: number; meta_mc_pct?: number; meta_ebitda_pct?: number; meta_lucro_pct?: number };
};

function GoalCard({ title, goalLabel, goal, actual, actualLabel, money }: {
  title: string; goalLabel: string; goal: number | undefined; actual: number; actualLabel: string; money?: boolean;
}) {
  const pct = goal ? Math.max(0, Math.min(150, (actual / goal) * 100)) : null;
  return (
    <Card>
      <CardContent className="pt-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <Target className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-semibold tabular-nums">{actualLabel}</div>
        {goal ? (
          <>
            <Progress value={Math.min(100, pct!)} className="h-2" />
            <div className="text-xs text-muted-foreground">
              Meta: {money ? formatCurrency(goal) : `${goal.toLocaleString("pt-BR")}%`} · {goalLabel}:{" "}
              <span className={pct! >= 100 ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
                {pct!.toFixed(0)}%
              </span>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">Sem meta definida — configure em Config.</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ControladoriaDashboardPage() {
  const { workspace } = useWorkspace();
  const [from, setFrom] = React.useState(firstDayOfMonth());
  const [to, setTo] = React.useState(lastDayOfMonth());
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/controladoria/report?view=dashboard&from=${from}&to=${to}`, {
        headers: { "x-workspace-id": workspace.id },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, from, to]);

  React.useEffect(() => { void load(); }, [load]);

  const dreValue = (key: string) => data?.dre.find((l) => l.key === key)?.value ?? 0;
  const drePct = (key: string) => data?.dre.find((l) => l.key === key)?.pct ?? null;
  const maxGasto = Math.max(1, ...(data?.gastos.map((g) => g.value) ?? [1]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Controladoria</h1>
          <p className="text-sm text-muted-foreground">
            DRE do período, metas e caixa — dados próprios (ex-SenseBoard), paridade validada.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Filtrar"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-300">
          <CardContent className="flex items-center gap-2 pt-5 text-red-700">
            <AlertTriangle className="h-4 w-4" /> Falha ao carregar: {error}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <GoalCard title="Receita de Vendas" goalLabel="atingido" money
              goal={data.goals.meta_receita_mensal} actual={dreValue("receita")}
              actualLabel={formatCurrency(dreValue("receita"))} />
            <GoalCard title="Margem de Contribuição" goalLabel="da meta"
              goal={data.goals.meta_mc_pct} actual={drePct("margem_contrib") ?? 0}
              actualLabel={fmtPct(drePct("margem_contrib"))} />
            <GoalCard title="Ebitda" goalLabel="da meta"
              goal={data.goals.meta_ebitda_pct} actual={drePct("ebitda") ?? 0}
              actualLabel={fmtPct(drePct("ebitda"))} />
            <GoalCard title="Lucro Líquido" goalLabel="da meta"
              goal={data.goals.meta_lucro_pct} actual={drePct("res_liquido") ?? 0}
              actualLabel={fmtPct(drePct("res_liquido"))} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">DRE do período</CardTitle>
                <Button asChild variant="outline" size="sm">
                  <Link href="/controladoria/dre">DRE anual <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">R$</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.dre.map((l) => (
                      <TableRow key={l.key} className={l.op === "=" ? "bg-muted/60" : undefined}>
                        <TableCell className={l.op === "=" ? "font-semibold" : undefined}>
                          <span className="text-muted-foreground text-xs mr-1">({l.op})</span>
                          {l.label}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${
                          l.op === "=" ? (l.value < 0 ? "text-red-600 font-semibold" : "text-blue-600 font-semibold")
                          : l.op === "-" ? "text-red-600/90" : ""
                        }`}>
                          {formatCurrency(l.value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(l.pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Entradas (caixa)</span><TrendingUp className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="text-xl font-semibold text-emerald-700 tabular-nums">{formatCurrency(data.dfcEntradas)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Saídas (caixa)</span><TrendingDown className="h-4 w-4 text-red-600" />
                    </div>
                    <div className="text-xl font-semibold text-red-600 tabular-nums">{formatCurrency(data.dfcSaidas)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Saldo inicial do período</span><Wallet className="h-4 w-4" />
                    </div>
                    <div className="text-xl font-semibold tabular-nums">{formatCurrency(data.saldoInicial)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Saldo final do período</span><Wallet className="h-4 w-4" />
                    </div>
                    <div className={`text-xl font-semibold tabular-nums ${data.saldoFinal < data.saldoInicial ? "text-red-600" : "text-emerald-700"}`}>
                      {formatCurrency(data.saldoFinal)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">Distribuição de gastos (competência)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.gastos.length === 0 && <p className="text-sm text-muted-foreground">Sem gastos no período.</p>}
                  {data.gastos.slice(0, 12).map((g) => (
                    <div key={g.label} className="flex items-center gap-2">
                      <div className="w-44 truncate text-xs" title={g.label}>{g.label}</div>
                      <div className="h-3 flex-1 rounded bg-muted overflow-hidden">
                        <div className="h-full rounded bg-blue-600" style={{ width: `${(g.value / maxGasto) * 100}%` }} />
                      </div>
                      <div className="w-28 text-right text-xs tabular-nums">{formatCurrency(g.value)}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
