"use client";

// BalanceCard — shows Locaweb sending credits next to the estimated send
// size. Used by both dispatch dialogs (suggestion + draft) so users see
// "you have X credits, this send needs Y" before firing.

import { useEffect, useState } from "react";
import { Wallet, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface BalanceState {
  configured: boolean;
  total: number | null;
  used: number | null;
  remaining: number | null;
  error?: string;
}

interface Props {
  workspaceId: string;
  /** Estimated number of recipients for this send. The card colors green
   *  when remaining covers it, red otherwise. */
  estimatedRecipients: number;
}

export function BalanceCard({ workspaceId, estimatedRecipients }: Props) {
  const [state, setState] = useState<BalanceState | null>(null);

  useEffect(() => {
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
            error: (err as Error).message,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (state === null) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground border rounded-md p-2.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Consultando saldo Locaweb...
      </div>
    );
  }

  if (!state.configured) {
    return null;
  }

  const remaining = state.remaining;
  const total = state.total;
  const sufficient =
    remaining == null
      ? null
      : estimatedRecipients <= 0
        ? true
        : remaining >= estimatedRecipients;
  const deficit =
    remaining != null && estimatedRecipients > remaining
      ? estimatedRecipients - remaining
      : 0;

  const tone =
    sufficient === false
      ? "border-destructive/40 bg-destructive/5"
      : sufficient === true && estimatedRecipients > 0
        ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800"
        : "border-border bg-muted/30";

  return (
    <div className={`border rounded-md p-3 space-y-1.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Wallet className="w-3 h-3" />
          Saldo Locaweb
        </div>
        {state.error ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {state.error.slice(0, 40)}
          </span>
        ) : null}
      </div>

      {state.error ? null : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tabular-nums">
              {remaining != null
                ? remaining.toLocaleString("pt-BR")
                : "—"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              envios disponíveis
              {total != null && (
                <>
                  {" "}
                  · de {total.toLocaleString("pt-BR")}
                </>
              )}
            </span>
          </div>

          {estimatedRecipients > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              {sufficient ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-300">
                    Suficiente para enviar pra{" "}
                    {estimatedRecipients.toLocaleString("pt-BR")} contatos.
                  </span>
                </>
              ) : sufficient === false ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-destructive">
                    Insuficiente — faltam{" "}
                    {deficit.toLocaleString("pt-BR")} créditos pra esse envio
                    ({estimatedRecipients.toLocaleString("pt-BR")} contatos).
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Estimativa de envio:{" "}
                  {estimatedRecipients.toLocaleString("pt-BR")} contatos.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
