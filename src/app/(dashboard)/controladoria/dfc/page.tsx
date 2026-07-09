"use client";

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";
import { ReportTable, BalanceRow, type ReportLine } from "../report-table";
import { MONTHS_SHORT, fmtReport } from "@/lib/controladoria/format";

const YEARS = Array.from({ length: 11 }, (_, i) => 2022 + i);

type DfcResponse = {
  year: number;
  entradas: number[];
  saidas: number[];
  liquidez: number[];
  saldoAcumulado: number[];
  saldoInicial: number[];
  lines: ReportLine[];
};

export default function DfcPage() {
  const { workspace } = useWorkspace();
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [view, setView] = React.useState<"consolidado" | "resumido" | "expandido">("consolidado");
  const [status, setStatus] = React.useState("todos");
  const [data, setData] = React.useState<DfcResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const level = view === "expandido" ? "expandido" : "resumido";
      const res = await fetch(
        `/api/controladoria/report?view=dfc&year=${year}&level=${level}&status=${status}`,
        { headers: { "x-workspace-id": workspace.id }, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, year, view, status]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DFC — Fluxo de Caixa — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Regime de caixa (pago → data de pagamento; pendente → vencimento) · transferências entre contas,
            depreciação e provisões ficam fora (regras validadas por paridade).
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
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList>
              <TabsTrigger value="consolidado">Consolidado</TabsTrigger>
              <TabsTrigger value="resumido">Resumido</TabsTrigger>
              <TabsTrigger value="expandido">Expandido</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
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

      {loading && !data && (
        <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Calculando DFC…
        </div>
      )}

      {data && view === "consolidado" && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Recebíveis</TableHead>
                <TableHead className="text-right">Saídas</TableHead>
                <TableHead className="text-right">Liquidez mensal</TableHead>
                <TableHead className="text-right">Saldo acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MONTHS_SHORT.map((m, idx) => (
                <TableRow key={m}>
                  <TableCell className="font-medium">{m}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{fmtReport(data.entradas[idx])}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-600/90">{fmtReport(data.saidas[idx])}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${data.liquidez[idx] < 0 ? "text-red-600" : "text-blue-600"}`}>
                    {fmtReport(data.liquidez[idx])}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${data.saldoAcumulado[idx] < 0 ? "text-red-600" : ""}`}>
                    {fmtReport(data.saldoAcumulado[idx])}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/60 font-semibold">
                <TableCell>Totais anuais</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">
                  {fmtReport(data.entradas.reduce((a, b) => a + b, 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums text-red-600">
                  {fmtReport(data.saidas.reduce((a, b) => a + b, 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtReport(data.liquidez.reduce((a, b) => a + b, 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtReport(data.saldoAcumulado[11])}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {data && view !== "consolidado" && (
        <ReportTable
          lines={data.lines}
          showPct={false}
          extraTop={<BalanceRow label="Saldo Inicial" values={data.saldoInicial} showPct={false} />}
        />
      )}
      {data && view !== "consolidado" && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableBody>
              <BalanceRow label="Saldo Final" values={data.saldoAcumulado} showPct={false} />
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
