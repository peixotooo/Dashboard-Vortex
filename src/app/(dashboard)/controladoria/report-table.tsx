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
  if (line.op === "=") return v < 0 ? "text-red-600 font-medium" : "text-blue-600 font-medium";
  if (line.op === "-") return "text-red-600/90";
  if (line.op === "+") return "text-emerald-700";
  return "";
}

function Row({ line, depth, showPct }: { line: ReportLine; depth: number; showPct: boolean }) {
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
            {line.months.map((v, m) => (
              <TableCell key={m} className={`text-right tabular-nums ${valueClass(line, v)}`}>
                {fmtReport(v)}
              </TableCell>
            ))}
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
        line.children!.map((c) => <Row key={c.key} line={c} depth={depth + 1} showPct={showPct} />)}
    </>
  );
}

export function ReportTable({ lines, showPct = true, extraTop }: {
  lines: ReportLine[];
  showPct?: boolean;
  extraTop?: React.ReactNode;
}) {
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
            <Row key={l.key} line={l} depth={0} showPct={showPct} />
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
        <TableCell key={m} className={`text-right tabular-nums font-medium ${v < 0 ? "text-red-600" : "text-emerald-700"}`}>
          {fmtReport(v)}
        </TableCell>
      ))}
      <TableCell colSpan={showPct ? 3 : 2} />
    </TableRow>
  );
}
