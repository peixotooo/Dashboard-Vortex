"use client";

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { ReportTable, type ReportLine } from "../report-table";
import { ReportDrillDialog } from "../report-drill-dialog";

const YEARS = Array.from({ length: 11 }, (_, i) => 2022 + i);

const NOW = new Date();

export default function DrePage() {
  const { workspace } = useWorkspace();
  const [year, setYear] = React.useState(NOW.getFullYear());
  const [level, setLevel] = React.useState<"resumido" | "expandido">("resumido");
  const [status, setStatus] = React.useState("todos");
  const [ytd, setYtd] = React.useState(true); // "até o mês atual" (padrão)
  const [lines, setLines] = React.useState<ReportLine[] | null>(null);
  const [hideZeros, setHideZeros] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [drill, setDrill] = React.useState<{ line: ReportLine; month: number } | null>(null);

  // o corte "até o mês atual" só faz sentido no ano corrente; anos passados
  // já estão completos e anos futuros são todos "planejados".
  const isCurrentYear = year === NOW.getFullYear();
  const visibleMonths = ytd && isCurrentYear ? NOW.getMonth() + 1 : 12;

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/controladoria/report?view=dre&year=${year}&level=${level}&status=${status}`,
        { headers: { "x-workspace-id": workspace.id }, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLines(json.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, year, level, status]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DRE Anual — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Regime de competência · transferências e lançamentos em revisão ficam fora (regra validada por paridade).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os lançamentos</SelectItem>
              <SelectItem value="pagos">Somente pagos</SelectItem>
              <SelectItem value="pendentes">Somente pendentes</SelectItem>
            </SelectContent>
          </Select>
          <Tabs value={level} onValueChange={(v) => setLevel(v as typeof level)}>
            <TabsList>
              <TabsTrigger value="resumido">Resumido</TabsTrigger>
              <TabsTrigger value="expandido">Expandido</TabsTrigger>
            </TabsList>
          </Tabs>
          {isCurrentYear && (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={ytd} onChange={(e) => setYtd(e.target.checked)} />
              Até o mês atual
            </label>
          )}
          {level === "expandido" && (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={hideZeros} onChange={(e) => setHideZeros(e.target.checked)} />
              Ocultar zeradas
            </label>
          )}
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center gap-2 pt-5 text-destructive">
            <AlertTriangle className="h-4 w-4" /> Falha ao carregar: {error}
          </CardContent>
        </Card>
      )}

      {loading && !lines && (
        <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Calculando DRE…
        </div>
      )}

      {lines && (
        <>
          <p className="-mt-1 text-xs text-muted-foreground">
            {visibleMonths < 12
              ? `Mostrando até ${["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][visibleMonths - 1]}/${year} (mês atual). Acumulado e média consideram só esse período — desmarque "Até o mês atual" para ver o ano todo. `
              : ""}
            Dica: clique em qualquer valor mensal para ver os lançamentos que compõem aquele número.
          </p>
          <ReportTable
            lines={lines}
            showPct
            hideZeros={hideZeros}
            visibleMonths={visibleMonths}
            onDrill={(line, month) => setDrill({ line, month })}
          />
        </>
      )}

      <ReportDrillDialog
        workspaceId={workspace?.id ?? ""}
        year={year}
        target={drill}
        onOpenChange={(o) => { if (!o) setDrill(null); }}
      />
    </div>
  );
}
