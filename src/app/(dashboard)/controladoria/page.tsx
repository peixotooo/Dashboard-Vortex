"use client";

import * as React from "react";
import Link from "next/link";
import {
  Loader2, AlertTriangle, Scale, ThumbsUp, TrendingDown, ArrowRight, Maximize2, Info,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { fmtPct, firstDayOfMonth, lastDayOfMonth } from "@/lib/controladoria/format";
import { Gauge } from "./gauge";
import { ReportTable, type ReportLine } from "./report-table";

type DreLine = { key: string; label: string; op: string; value: number; pct: number | null };
type Dashboard = {
  from: string; to: string;
  dre: DreLine[];
  gastos: { label: string; value: number }[];
  dfcEntradas: number; dfcSaidas: number; totalSaidas: number;
  saldoInicial: number; saldoFinal: number;
  pontoEquilibrio: number; pontoEquilibrioIdeal: number; metaReceita: number;
  diario: { date: string; entrada: number; saida: number; saldo: number }[];
  goals: { meta_receita_mensal?: number; meta_mc_pct?: number; meta_ebitda_pct?: number; meta_lucro_pct?: number };
};

function GaugeCard({ title, apuradoLabel, metaLabel, ratio, valor, hint }: {
  title: string; apuradoLabel: string; metaLabel: string; ratio: number; valor?: string; hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <span title={hint}><Info className="h-4 w-4 text-muted-foreground" /></span>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex justify-center"><Gauge ratio={ratio} /></div>
        <div className="mt-1 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Meta:</span><span className="font-medium tabular-nums">{metaLabel}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Apurado:</span><span className="font-medium tabular-nums">{apuradoLabel}</span></div>
          {valor && <div className="flex justify-between"><span className="text-muted-foreground">Valor:</span><span className="font-medium tabular-nums text-blue-600">{valor}</span></div>}
        </div>
      </CardContent>
    </Card>
  );
}

function PillCard({ icon, title, value, tone, hint }: {
  icon: React.ReactNode; title: string; value: string; tone: "blue" | "green" | "red"; hint: string;
}) {
  const border = tone === "red" ? "border-red-300" : tone === "green" ? "border-emerald-300" : "border-blue-300";
  const text = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : "text-blue-600";
  return (
    <Card className={`border ${border}`}>
      <CardContent className="pt-5 text-center">
        <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {icon} {title} <span title={hint}><Info className="h-3.5 w-3.5" /></span>
        </div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${text}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function ControladoriaDashboardPage() {
  const { workspace } = useWorkspace();
  const [from, setFrom] = React.useState(firstDayOfMonth());
  const [to, setTo] = React.useState(lastDayOfMonth());
  const [status, setStatus] = React.useState("todos");
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<ReportLine[] | null>(null);
  const [expandedOpen, setExpandedOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/controladoria/report?view=dashboard&from=${from}&to=${to}&status=${status}`, {
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
  }, [workspace?.id, from, to, status]);

  React.useEffect(() => { void load(); }, [load]);

  const openExpanded = async () => {
    if (!workspace?.id) return;
    setExpandedOpen(true);
    const year = parseInt(from.slice(0, 4), 10);
    const res = await fetch(`/api/controladoria/report?view=dre&year=${year}&level=expandido&status=${status}`, {
      headers: { "x-workspace-id": workspace.id }, cache: "no-store",
    });
    if (res.ok) setExpanded((await res.json()).lines);
  };

  const dreValue = (key: string) => data?.dre.find((l) => l.key === key)?.value ?? 0;
  const drePct = (key: string) => data?.dre.find((l) => l.key === key)?.pct ?? 0;
  const maxGasto = Math.max(1, ...(data?.gastos.map((g) => g.value) ?? [1]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Controladoria</h1>
          <p className="text-sm text-muted-foreground">Dashboard do período — dados próprios (ex-SenseBoard).</p>
        </div>
        <div className="flex items-end gap-2">
          <div><label className="text-xs text-muted-foreground">Período</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
          <div><label className="text-xs text-muted-foreground">até</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os lançamentos</SelectItem>
              <SelectItem value="pagos">Somente pagos</SelectItem>
              <SelectItem value="pendentes">Somente pendentes</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Filtrar"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-300"><CardContent className="flex items-center gap-2 pt-5 text-red-700"><AlertTriangle className="h-4 w-4" /> Falha ao carregar: {error}</CardContent></Card>
      )}

      {data && (
        <>
          {/* DRE resumido + 4 gauges */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:row-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">DRE Resumido</CardTitle>
                <Button variant="outline" size="sm" onClick={() => void openExpanded()}>DRE Expandido</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Descrição</TableHead><TableHead className="text-right">R$</TableHead><TableHead className="text-right">%</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.dre.map((l) => (
                      <TableRow key={l.key} className={l.op === "=" ? "bg-muted/60" : undefined}>
                        <TableCell className={l.op === "=" ? "font-semibold" : undefined}>
                          <span className="text-muted-foreground text-xs mr-1">({l.op})</span>{l.label}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${l.op === "=" ? (l.value < 0 ? "text-red-600 font-semibold" : "text-blue-600 font-semibold") : l.op === "-" ? "text-red-600/90" : ""}`}>{formatCurrency(l.value)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(l.pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <GaugeCard title="Receitas de Vendas" hint="Meta = valor mensal em Config escalado pelo período; se vazio, usa o Ponto de Equilíbrio."
              ratio={data.metaReceita > 0 ? dreValue("receita") / data.metaReceita : 0}
              metaLabel={formatCurrency(data.metaReceita)} apuradoLabel={formatCurrency(dreValue("receita"))} />
            <GaugeCard title="Margem de Contribuição" hint="Meta definida em Config. MC = Receita − Custos Variáveis."
              ratio={(data.goals.meta_mc_pct ?? 60) > 0 ? drePct("margem_contrib") / (data.goals.meta_mc_pct ?? 60) : 0}
              metaLabel={`${(data.goals.meta_mc_pct ?? 60).toLocaleString("pt-BR")}%`} apuradoLabel={fmtPct(drePct("margem_contrib"))} valor={formatCurrency(dreValue("margem_contrib"))} />
            <GaugeCard title="Ebitda" hint="Saúde financeira operacional — mantenha positivo. Meta em Config."
              ratio={(data.goals.meta_ebitda_pct ?? 5) > 0 ? drePct("ebitda") / (data.goals.meta_ebitda_pct ?? 5) : 0}
              metaLabel={`${(data.goals.meta_ebitda_pct ?? 5).toLocaleString("pt-BR")}%`} apuradoLabel={fmtPct(drePct("ebitda"))} valor={formatCurrency(dreValue("ebitda"))} />
            <GaugeCard title="Lucro Líquido" hint="O que gera investimento e crescimento. Meta em Config."
              ratio={(data.goals.meta_lucro_pct ?? 4) > 0 ? drePct("res_liquido") / (data.goals.meta_lucro_pct ?? 4) : 0}
              metaLabel={`${(data.goals.meta_lucro_pct ?? 4).toLocaleString("pt-BR")}%`} apuradoLabel={fmtPct(drePct("res_liquido"))} valor={formatCurrency(dreValue("res_liquido"))} />
          </div>

          {/* Pontos de equilíbrio + total de saídas */}
          <div className="grid gap-4 md:grid-cols-3">
            <PillCard icon={<Scale className="h-4 w-4" />} tone="blue" title="Ponto de Equilíbrio Financeiro"
              value={formatCurrency(data.pontoEquilibrio)} hint="Cota mínima (Break Even) = Gastos Fixos / Margem de Contribuição%." />
            <PillCard icon={<ThumbsUp className="h-4 w-4" />} tone="blue" title="Ponto de Equilíbrio Ideal"
              value={formatCurrency(data.pontoEquilibrioIdeal)} hint="Cota objetiva = (Gastos Fixos + Lucro Requerido) / (MC% − Margem de Segurança). Estimativa — pode variar ~1% do SenseBoard quando a margem do período é baixa." />
            <PillCard icon={<TrendingDown className="h-4 w-4" />} tone="red" title="Total de saídas"
              value={formatCurrency(data.totalSaidas)} hint="Total de saídas que constam no DRE do período." />
          </div>

          {/* Distribuição de gastos */}
          <Card>
            <CardHeader><CardTitle className="text-base">Distribuição de gastos</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.gastos.length === 0 && <p className="text-sm text-muted-foreground">Sem gastos acima de 1% no período.</p>}
              {data.gastos.map((g) => (
                <div key={g.label} className="flex items-center gap-2">
                  <div className="w-52 truncate text-xs" title={g.label}>{g.label}</div>
                  <div className="h-4 flex-1 rounded bg-muted overflow-hidden">
                    <div className="h-full rounded bg-blue-600" style={{ width: `${(g.value / maxGasto) * 100}%` }} />
                  </div>
                  <div className="w-28 text-right text-xs tabular-nums">{formatCurrency(g.value)}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* DFC por dia */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">DFC — Demonstrativo de Fluxo de Caixa por dia</CardTitle>
              <span className="text-xs text-muted-foreground">Saldo · Entrada · Saída (só dias com lançamento)</span>
            </CardHeader>
            <CardContent>
              {data.diario.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Sem lançamentos de caixa no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.diario} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} fontSize={11} minTickGap={24} />
                    <YAxis tickFormatter={(v: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v)} fontSize={11} width={56} />
                    <RTooltip
                      formatter={(v, n) => [formatCurrency(Number(v)), n === "saldo" ? "Saldo" : n === "entrada" ? "Entrada" : "Saída"] as [string, string]}
                      labelFormatter={(d) => new Date(String(d) + "T00:00:00").toLocaleDateString("pt-BR")}
                    />
                    <Line type="monotone" dataKey="saldo" stroke="#22c55e" strokeWidth={2} dot={false} name="saldo" />
                    <Line type="monotone" dataKey="entrada" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="entrada" />
                    <Line type="monotone" dataKey="saida" stroke="#ef4444" strokeWidth={1.5} dot={false} name="saida" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Saldos + atalhos */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Saldo inicial do período</div><div className="text-2xl font-semibold tabular-nums">{formatCurrency(data.saldoInicial)}</div></CardContent></Card>
            <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Saldo final do período</div><div className={`text-2xl font-semibold tabular-nums ${data.saldoFinal < data.saldoInicial ? "text-red-600" : "text-emerald-700"}`}>{formatCurrency(data.saldoFinal)}</div></CardContent></Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/controladoria/dre">DRE Anual <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
            <Button asChild variant="outline"><Link href="/controladoria/dfc">DFC Anual <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
            <Button asChild variant="outline"><Link href="/controladoria/lancamentos">Lançamentos <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
          </div>
        </>
      )}

      <Dialog open={expandedOpen} onOpenChange={setExpandedOpen}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Maximize2 className="h-4 w-4" /> DRE Expandido — {from.slice(0, 4)}</DialogTitle></DialogHeader>
          {expanded ? <ReportTable lines={expanded} showPct hideZeros /> : <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Carregando…</div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
