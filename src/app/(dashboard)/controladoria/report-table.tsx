"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MONTHS_SHORT, fmtReport, fmtPct } from "@/lib/controladoria/format";

export type ReportLine = {
  key: string;
  label: string;
  op: "+" | "-" | "=" | "" | "±";
  months: number[];
  accum: number;
  media: number;
  pct: number | null;
  emphasis?: boolean;
  children?: ReportLine[];
};

function valueClass(line: ReportLine, v: number): string {
  if (Math.abs(v) < 0.005) return "text-muted-foreground/50";
  if (line.op === "=") return v < 0 ? "text-destructive font-medium" : "text-info font-medium";
  if (line.op === "-") return "text-destructive/90";
  if (line.op === "+") return "text-success";
  return "";
}

// Linhas de RESULTADO do DRE (soma de outras linhas, com +/−): não têm
// lançamentos diretos, então não são clicáveis para drill-down.
const LINHAS_DERIVADAS = new Set([
  "receita_liquida", "margem_bruta", "margem_contrib", "ebitda", "res_bruto", "res_liquido", "res_final",
]);
const podeDrill = (line: ReportLine) => !LINHAS_DERIVADAS.has(line.key);

export type DrillHandler = (line: ReportLine, month: number) => void;

function Row({ line, depth, showPct, onDrill }: { line: ReportLine; depth: number; showPct: boolean; onDrill?: DrillHandler }) {
  const [open, setOpen] = React.useState(false);
  const hasChildren = !!line.children?.length;
  const isSection = line.op === "" && line.emphasis && line.months.every((v) => Math.abs(v) < 0.005);
  return (
    <>
      <TableRow className={line.emphasis ? "bg-muted/60 hover:bg-muted" : undefined}>
        <TableCell
          className={`sticky left-0 z-10 whitespace-nowrap ${line.emphasis ? "bg-muted font-semibold" : "bg-background"}`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <button
            type="button"
            onClick={() => hasChildren && setOpen((o) => !o)}
            className={`inline-flex items-center gap-1 text-left ${hasChildren ? "cursor-pointer hover:underline" : "cursor-default"}`}
          >
            {hasChildren ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
            {line.op && <span className="text-muted-foreground text-xs">({line.op})</span>}
            <span className={line.emphasis ? "font-semibold" : undefined}>{line.label}</span>
          </button>
        </TableCell>
        {isSection ? (
          <TableCell colSpan={12 + 2 + (showPct ? 1 : 0)} className="bg-muted/60" />
        ) : (
          <>
            {line.months.map((v, m) => {
              const canDrill = !!onDrill && podeDrill(line) && Math.abs(v) >= 0.005;
              return (
                <TableCell key={m} className={`text-right tabular-nums ${valueClass(line, v)}`}>
                  {canDrill ? (
                    <button
                      type="button"
                      onClick={() => onDrill!(line, m)}
                      title="Ver lançamentos que compõem este valor"
                      className="cursor-pointer rounded px-1 underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:bg-primary/10 hover:decoration-current"
                    >
                      {fmtReport(v)}
                    </button>
                  ) : (
                    fmtReport(v)
                  )}
                </TableCell>
              );
            })}
            <TableCell className={`text-right tabular-nums font-medium ${valueClass(line, line.accum)}`}>
              {fmtReport(line.accum)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{fmtReport(line.media)}</TableCell>
            {showPct && (
              <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(line.pct)}</TableCell>
            )}
          </>
        )}
      </TableRow>
      {open &&
        line.children!.map((c) => <Row key={c.key} line={c} depth={depth + 1} showPct={showPct} onDrill={onDrill} />)}
    </>
  );
}

function pruneZeros(lines: ReportLine[]): ReportLine[] {
  return lines
    .map((l) => (l.children ? { ...l, children: pruneZeros(l.children) } : l))
    .filter((l) => l.emphasis || Math.abs(l.accum) >= 0.005 || (l.children?.length ?? 0) > 0);
}

export function ReportTable({ lines: rawLines, showPct = true, extraTop, hideZeros = false, onDrill }: {
  lines: ReportLine[];
  showPct?: boolean;
  extraTop?: React.ReactNode;
  hideZeros?: boolean;
  onDrill?: DrillHandler;
}) {
  const lines = React.useMemo(() => (hideZeros ? pruneZeros(rawLines) : rawLines), [rawLines, hideZeros]);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-background min-w-[260px]">Descrição</TableHead>
            {MONTHS_SHORT.map((m) => (
              <TableHead key={m} className="text-right min-w-[88px]">{m}</TableHead>
            ))}
            <TableHead className="text-right min-w-[100px]">Acum.</TableHead>
            <TableHead className="text-right min-w-[90px]">Média</TableHead>
            {showPct && <TableHead className="text-right min-w-[70px]">%</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {extraTop}
          {lines.map((l) => (
            <Row key={l.key} line={l} depth={0} showPct={showPct} onDrill={onDrill} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function BalanceRow({ label, values, showPct }: { label: string; values: number[]; showPct: boolean }) {
  return (
    <TableRow className="bg-emerald-50/60 dark:bg-emerald-950/30">
      <TableCell className="sticky left-0 z-10 bg-emerald-50 dark:bg-emerald-950 font-semibold whitespace-nowrap">
        {label}
      </TableCell>
      {values.map((v, m) => (
        <TableCell key={m} className={`text-right tabular-nums font-medium ${v < 0 ? "text-destructive" : "text-success"}`}>
          {fmtReport(v)}
        </TableCell>
      ))}
      <TableCell colSpan={showPct ? 3 : 2} />
    </TableRow>
  );
}
