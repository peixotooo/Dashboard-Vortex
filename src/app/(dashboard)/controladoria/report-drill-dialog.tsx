"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { fmtDateBR, MONTHS_SHORT } from "@/lib/controladoria/format";
import type { ReportLine } from "./report-table";

type DrillRow = {
  id: string;
  provision: boolean;
  descricao: string;
  parceiro: string | null;
  classificacao: string;
  competencia: string | null;
  vencimento: string | null;
  pago: string | null;
  valor: number;
  detalhe?: string;
};

export function ReportDrillDialog({
  workspaceId, year, target, onOpenChange,
}: {
  workspaceId: string;
  year: number;
  target: { line: ReportLine; month: number } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = React.useState<DrillRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [avisos, setAvisos] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const line = target?.line;
  const month = target?.month ?? 0;
  const cellValue = line ? line.months[month] : 0;

  React.useEffect(() => {
    if (!target || !workspaceId) return;
    let cancelled = false;
    setLoading(true); setError(null); setRows(null);
    const params = new URLSearchParams({ key: target.line.key, month: String(target.month), year: String(year) });
    fetch(`/api/controladoria/report/drill?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error === "linha_derivada" ? "Esta linha é um resultado (soma de outras) — não tem lançamentos diretos." : j.error ?? `HTTP ${r.status}`);
        return j;
      })
      .then((j) => { if (!cancelled) { setRows(j.rows); setTotal(j.total); setAvisos(j.avisos ?? []); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "erro"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, workspaceId, year]);

  const bateComCelula = Math.abs(total - cellValue) < 0.02;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-x-2">
            <span>{line?.label}</span>
            <span className="text-sm font-normal text-muted-foreground">
              · {MONTHS_SHORT[month]}/{year}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">Valor no DRE</span>
          <span className="text-lg font-semibold tabular-nums">{formatCurrency(cellValue)}</span>
        </div>

        {avisos.map((a, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-amber-300 p-2 text-xs text-amber-800 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
          </div>
        ))}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Buscando lançamentos…
          </div>
        )}

        {rows && !loading && (
          <>
            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum lançamento neste mês para esta linha.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parceiro / Descrição</TableHead>
                      <TableHead>Classificação</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-center">Pago</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className={r.provision ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined}>
                        <TableCell className="max-w-[260px]">
                          <div className="truncate font-medium">{r.parceiro ?? r.descricao}</div>
                          {r.parceiro && r.descricao !== "—" && (
                            <div className="truncate text-xs text-muted-foreground">{r.descricao}</div>
                          )}
                          {r.detalhe && <div className="text-xs text-amber-700 dark:text-amber-400">{r.detalhe}</div>}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{r.classificacao}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{fmtDateBR(r.competencia)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{r.provision ? "—" : fmtDateBR(r.vencimento)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatCurrency(r.valor)}</TableCell>
                        <TableCell className="text-center">
                          {r.provision ? (
                            <span className="text-xs text-muted-foreground">prov.</span>
                          ) : r.pago ? (
                            <span className="text-xs text-emerald-600">✓</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex items-center justify-between px-1 text-sm">
              <span className="text-muted-foreground">
                {rows.length} {rows.length === 1 ? "lançamento" : "lançamentos"}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Soma</span>
                <span className={`text-base font-semibold tabular-nums ${bateComCelula ? "" : "text-amber-700 dark:text-amber-400"}`}>
                  {formatCurrency(total)}
                </span>
              </span>
            </div>
            {!bateComCelula && rows.length > 0 && (
              <p className="px-1 text-xs text-amber-700 dark:text-amber-400">
                A soma difere do valor do DRE — geralmente por provisão calculada. Veja o aviso acima.
              </p>
            )}
            <a
              href="/controladoria/lancamentos"
              className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Abrir em Lançamentos para editar
            </a>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
