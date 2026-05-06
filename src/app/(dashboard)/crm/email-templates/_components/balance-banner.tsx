"use client";

// Module-wide balance banner. Shows the workspace's Locaweb sending credit
// balance at the top of every email-templates page (Sugestões, Galeria,
// Drafts, Relatórios) so the user doesn't have to open a dispatch dialog
// to see how many envios they have left.
//
// Mounted from the email-templates layout.tsx so it persists across tab
// changes within the module.

import { useEffect, useState } from "react";
import { Wallet, AlertTriangle, Loader2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";

interface BalanceState {
  configured: boolean;
  total: number | null;
  used: number | null;
  remaining: number | null;
  extra: number | null;
  plan_name: string | null;
  period_start: string | null;
  period_end: string | null;
  error?: string;
  debug?: unknown;
}

export function BalanceBanner() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [state, setState] = useState<BalanceState | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch("/api/crm/email-templates/locaweb/balance", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: BalanceState) => {
        if (!cancelled) setState(d);
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            configured: true,
            total: null,
            used: null,
            remaining: null,
            extra: null,
            plan_name: null,
            period_start: null,
            period_end: null,
            error: (err as Error).message,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!workspaceId || state === null) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground border rounded-md px-3 py-2 bg-muted/20">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Consultando saldo Locaweb...
      </div>
    );
  }

  if (!state.configured) {
    return null;
  }

  if (state.error) {
    return (
      <div className="flex items-center gap-2 text-[11px] border rounded-md px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" />
        Saldo Locaweb indisponível: {state.error.slice(0, 120)}
      </div>
    );
  }

  const remaining = state.remaining;
  const total = state.total;
  const used = state.used;

  // Loose threshold to nudge the user when the account is running low.
  // 5k envios is a typical small-batch send; below that we shade amber.
  const lowBalance = remaining != null && remaining < 5000;

  const tone = lowBalance
    ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
    : "bg-muted/20 border-border";

  return (
    <div
      className={`flex items-center gap-3 border rounded-md px-3 py-2 ${tone}`}
    >
      <Wallet
        className={`w-4 h-4 shrink-0 ${
          lowBalance ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        }`}
      />
      <div className="flex items-baseline gap-1.5 flex-wrap text-xs">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Saldo Locaweb
        </span>
        <span className="font-semibold tabular-nums">
          {remaining != null ? remaining.toLocaleString("pt-BR") : "—"}
        </span>
        <span className="text-muted-foreground">envios disponíveis</span>
        {total != null && (
          <span className="text-muted-foreground">
            · de {total.toLocaleString("pt-BR")}
          </span>
        )}
        {used != null && (
          <span className="text-muted-foreground">
            · {used.toLocaleString("pt-BR")} usados
          </span>
        )}
        {state.plan_name && (
          <span className="text-muted-foreground">· {state.plan_name}</span>
        )}
        {state.period_end && (
          <span className="text-muted-foreground">
            · renova {state.period_end}
          </span>
        )}
        {state.extra != null && state.extra > 0 && (
          <span className="text-muted-foreground">
            · +{state.extra.toLocaleString("pt-BR")} extra
          </span>
        )}
        {lowBalance && (
          <span className="text-amber-700 dark:text-amber-300 font-medium">
            · saldo baixo
          </span>
        )}
        {state.debug != null && (
          <span
            className="text-[10px] text-muted-foreground cursor-help"
            title={JSON.stringify(state.debug, null, 2)}
          >
            (resposta inesperada — passe o mouse pra ver)
          </span>
        )}
      </div>
    </div>
  );
}
