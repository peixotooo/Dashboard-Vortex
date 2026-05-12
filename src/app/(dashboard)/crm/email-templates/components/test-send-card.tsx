"use client";

// Reusable "Teste antes de disparar" card. Shared between the suggestion
// dispatch dialog and the editor draft dispatch dialog so the test-first
// flow is identical everywhere a user can fire a campaign. Pre-fills the
// recipient with the logged-in user's email and only persists the latest
// successful send to the parent.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, Mail, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

interface TestSendCardProps {
  /** API endpoint that accepts { test_emails: string[] }. */
  endpoint: string;
  /** workspace id sent as x-workspace-id header. */
  workspaceId: string;
  /** Disables the test inputs/buttons (used while a real dispatch is in flight). */
  disabled?: boolean;
  /** Called when a test send succeeds. Parent uses this to advance UI / unlock the real-send stage. */
  onSent?: (email: string) => void;
}

export function TestSendCard({
  endpoint,
  workspaceId,
  disabled,
  onSent,
}: TestSendCardProps) {
  const { user } = useAuth();
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentDetails, setSentDetails] = useState<{
    iporto_message_ids?: string[];
    iporto_responses?: Array<{ email: string; body: unknown }>;
  } | null>(null);

  useEffect(() => {
    setTestEmail(user?.email ?? "");
    setSentTo(null);
    setSentDetails(null);
    setError(null);
    setErrorDetails(null);
  }, [user?.email, endpoint]);

  const send = async () => {
    const email = testEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Email de teste inválido.");
      return;
    }
    setLoading(true);
    setError(null);
    setErrorDetails(null);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ test_emails: [email] }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErrorDetails(d.iporto_responses ?? d.details ?? null);
        throw new Error(d.error ?? "Falha ao enviar teste.");
      }
      setSentTo(email);
      setSentDetails({
        iporto_message_ids: d.iporto_message_ids,
        iporto_responses: d.iporto_responses,
      });
      onSent?.(email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 border rounded-md p-4 bg-foreground/[0.02]">
      <div className="flex items-start gap-2">
        <Eye className="w-4 h-4 text-foreground/70 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="text-xs font-medium">Teste antes de disparar</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Recomendamos enviar uma cópia para o seu email primeiro. Você
            confere como o template chega na caixa de entrada — botão,
            espaçamento, links — antes de mandar pra audiência real.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="test-email-input"
          className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"
        >
          <Mail className="w-3 h-3" />
          Enviar teste para
        </Label>
        <Input
          id="test-email-input"
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          disabled={loading || disabled}
          className="h-9 text-xs"
          placeholder="seu@email.com"
        />
      </div>

      {sentTo && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-[11px] p-2.5 border border-emerald-300 bg-emerald-100 dark:bg-emerald-950 dark:border-emerald-700 rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div className="text-emerald-900 dark:text-emerald-100">
              Teste enviado para <span className="font-mono">{sentTo}</span>.
              Pode levar até alguns minutos pra chegar.
              {sentDetails?.iporto_message_ids &&
                sentDetails.iporto_message_ids.length > 0 && (
                  <span className="ml-1">
                    iPORTO id:{" "}
                    <span className="font-mono">
                      {sentDetails.iporto_message_ids[0]}
                    </span>
                  </span>
                )}
            </div>
          </div>
          {sentDetails?.iporto_responses && (
            <details className="text-[10px] text-muted-foreground">
              <summary className="cursor-pointer">Resposta crua do iPORTO</summary>
              <pre className="mt-1 p-2 bg-muted rounded overflow-auto text-[10px]">
                {JSON.stringify(sentDetails.iporto_responses, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5 space-y-1">
          <div>{error}</div>
          {errorDetails != null && (
            <details className="text-[10px]">
              <summary className="cursor-pointer">Detalhes</summary>
              <pre className="mt-1 p-2 bg-background rounded overflow-auto text-[10px]">
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      <Button
        size="sm"
        variant={sentTo ? "outline" : "default"}
        onClick={send}
        disabled={loading || disabled || !testEmail.trim()}
        className="gap-1.5"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        )}
        {loading ? "Enviando..." : sentTo ? "Reenviar teste" : "Enviar teste"}
      </Button>
    </div>
  );
}
