"use client";

// EmailListCreateDialog — turns a filtered customer set from the CRM page
// into a Locaweb email-marketing list. Mirrors the WhatsApp campaign flow
// (same trigger spot, same contact-shape input) so the user can
// roundtrip CRM segmentation → email blast without bouncing through the
// Locaweb panel manually.
//
// The actual list creation + contact push happens server-side at
// POST /api/crm/email-templates/locaweb/lists. This dialog is just the
// confirm/name step.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Mail,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";

interface Contact {
  email: string;
  name?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  /** Pre-filled list name suggestion (e.g. "RFM · Champions · Noite"). */
  suggestedName?: string;
}

export function EmailListCreateDialog({
  open,
  onOpenChange,
  contacts,
  suggestedName,
}: Props) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    list_id: string;
    list_name: string;
    pushed: number;
    total: number;
    warning?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName ?? defaultName());
    setError(null);
    setResult(null);
  }, [open, suggestedName]);

  const validEmails = contacts.filter(
    (c) => typeof c.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)
  ).length;

  const submit = async () => {
    if (!name.trim()) {
      setError("Informe um nome para a lista.");
      return;
    }
    if (validEmails === 0) {
      setError("Nenhum dos contatos selecionados tem email válido.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/crm/email-templates/locaweb/lists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          name: name.trim(),
          contacts: contacts.map((c) => ({ email: c.email, name: c.name ?? null })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Falha ao criar lista.");
      setResult({
        list_id: d.list_id,
        list_name: d.list_name,
        pushed: d.pushed,
        total: d.total,
        warning: d.warning ?? null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (loading) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Criar lista de email (Locaweb)
        </DialogTitle>
        <DialogDescription className="text-xs">
          A lista vai ser criada na Locaweb com os contatos selecionados. Em
          seguida, você consegue dispará-la pelo módulo Email Templates.
        </DialogDescription>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-medium text-emerald-700 dark:text-emerald-300">
                  Lista criada
                </div>
                <div className="text-muted-foreground">
                  <span className="font-mono">{result.list_name}</span> · id{" "}
                  <span className="font-mono">{result.list_id}</span>
                </div>
                <div className="text-muted-foreground">
                  {result.pushed.toLocaleString("pt-BR")} de{" "}
                  {result.total.toLocaleString("pt-BR")} contatos enviados.
                </div>
                {result.warning && (
                  <div className="text-amber-700 dark:text-amber-300 mt-1 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    {result.warning}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={close}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs p-3 border rounded bg-muted/30">
              <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {validEmails.toLocaleString("pt-BR")} contato
                  {validEmails === 1 ? "" : "s"} com email válido
                </div>
                {validEmails < contacts.length && (
                  <div className="text-[10px] text-muted-foreground">
                    {(contacts.length - validEmails).toLocaleString("pt-BR")} sem
                    email serão ignorados.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-name" className="text-xs">
                Nome da lista
              </Label>
              <Input
                id="list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="h-9 text-sm"
                placeholder="Ex: RFM Champions · Noite"
                maxLength={120}
              />
              <p className="text-[10px] text-muted-foreground">
                Esse nome aparece no painel da Locaweb e na seleção de listas
                ao disparar.
              </p>
            </div>

            {error && (
              <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={close} disabled={loading}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={loading || !name.trim() || validEmails === 0}
                className="gap-1.5"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                {loading ? "Criando..." : `Criar lista (${validEmails})`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function defaultName(): string {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  return `CRM · ${date}`;
}
