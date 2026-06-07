import * as React from "react";
import { cn } from "@/lib/utils";

// Faixa/banner informativo de ALTO CONTRASTE.
//
// REGRA DURA (recorrente): banner colorido NUNCA pode ter fundo claro + texto
// claro. Por isso as variantes aqui são fixas no par fundo-100 / borda-300 /
// texto-900 (e invertido no dark: 950/800/100) — sempre legível. Use este
// componente em vez de montar `bg-X-50 text-X-700` na mão.
type CalloutTone = "amber" | "emerald" | "red" | "blue" | "neutral";

const TONES: Record<CalloutTone, string> = {
  amber:
    "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100",
  emerald:
    "bg-emerald-100 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100",
  red:
    "bg-red-100 border-red-300 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100",
  blue:
    "bg-blue-100 border-blue-300 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-100",
  neutral: "bg-muted border-border text-foreground",
};

export function Callout({
  tone = "amber",
  icon,
  className,
  children,
}: {
  tone?: CalloutTone;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-xs flex items-start gap-2",
        // `<code>` interno ganha fundo próprio com contraste — nunca herda um tom claro.
        "[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono dark:[&_code]:bg-white/20",
        TONES[tone],
        className
      )}
    >
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
