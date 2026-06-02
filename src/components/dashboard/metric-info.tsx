"use client";

// Tooltip explicativo padronizado para as métricas do simulador/controle.
//
//   <MetricInfo k="mer_blended" />        -> só o ícone (?) com o texto do glossário
//   <MetricLabel k="mer_blended" />       -> rótulo + ícone (?)
//   <MetricStat k="mer_blended" value="2.4x" tone="good" /> -> card completo
//
// O texto vem SEMPRE do glossário (src/lib/financeiro/glossary.ts), então
// a explicação é única e consistente em todo o módulo. Cada componente é
// auto-contido (inclui o próprio TooltipProvider), então funciona em
// qualquer página sem depender de provider no layout.

import * as React from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GLOSSARY, type MetricKey } from "@/lib/financeiro/glossary";
import { cn } from "@/lib/utils";

function TooltipBody({ k }: { k: MetricKey }) {
  const e = GLOSSARY[k];
  if (!e) return null;
  return (
    <div className="space-y-1.5">
      <p className="font-semibold">{e.label}</p>
      <p className="leading-relaxed">{e.full}</p>
      {e.formula && (
        <p className="font-mono text-[11px] text-primary-foreground/80">{e.formula}</p>
      )}
      {e.caveat && (
        <p className="leading-relaxed text-primary-foreground/70">
          <span className="font-semibold">Atenção:</span> {e.caveat}
        </p>
      )}
    </div>
  );
}

/** Só o ícone de ajuda (?) com o tooltip do glossário. */
export function MetricInfo({ k, className }: { k: MetricKey; className?: string }) {
  if (!GLOSSARY[k]) return null;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors align-middle",
              className
            )}
            aria-label={`O que é ${GLOSSARY[k].label}?`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <TooltipBody k={k} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Rótulo de métrica + ícone de ajuda. Use no header de um card/coluna. */
export function MetricLabel({
  k,
  children,
  className,
}: {
  k: MetricKey;
  children?: React.ReactNode;
  className?: string;
}) {
  const label = children ?? GLOSSARY[k]?.label ?? k;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span>{label}</span>
      <MetricInfo k={k} />
    </span>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-success",
  warn: "text-amber-500",
  bad: "text-destructive",
  neutral: "text-foreground",
};

/** Card de métrica com rótulo + tooltip + valor + sublinha opcional. */
export function MetricStat({
  k,
  value,
  sub,
  tone = "neutral",
  label,
  className,
}: {
  k: MetricKey;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  /** Sobrescreve o rótulo do glossário, se quiser um nome contextual. */
  label?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{label ?? GLOSSARY[k]?.label ?? k}</span>
        <MetricInfo k={k} />
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums", TONE_CLASS[tone])}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
