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
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    setTestEmail(user?.email ?? "");
    setSentTo(null);
    setError(null);
  }, [user?.email, endpoint]);

  const send = async () => {
    const email = testEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Email de teste inválido.");
      return;
    }
    setLoading(true);
    setError(null);
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
      if (!r.ok) throw new Error(d.error ?? "Falha ao enviar teste.");
      setSentTo(email);
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
        <div className="flex items-start gap-2 text-[11px] p-2.5 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 rounded">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-emerald-700 dark:text-emerald-300">
            Teste enviado para <span className="font-mono">{sentTo}</span>. Pode
            levar até alguns minutos pra chegar.
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
          {error}
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
