"use client";

// EmailListCreateDialog — turns a filtered customer set from the CRM page
// into a Locaweb email-marketing list. Mirrors the WhatsApp campaign flow
// (same trigger spot, same contact-shape input).
//
// Implementation note: large contact sets (10k+) used to ship as a single
// /lists POST and routinely 504'd. Probing Locaweb directly:
//   - 100 contacts → 14s
//   - 500 contacts → 46s
//   - 1000 contacts → 504 from Locaweb itself
// They process ~140ms per contact. Their async import endpoint
// (contact_imports) returns 404 on the current plan, so we can't
// offload there.
//
// Solution: small chunks (75 ≈ 10s each, well under any timeout) shipped
// with bounded parallelism (4 concurrent requests) so wall-clock for
// 7k contacts stays around 4 min instead of 16 min sequential. Locaweb
// dedups on add, so partial failures are safe to retry.

import { useEffect, useRef, useState } from "react";
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

const CHUNK_SIZE = 75;
const CONCURRENCY = 4;

export function EmailListCreateDialog({
  open,
  onOpenChange,
  contacts,
  suggestedName,
}: Props) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading" | "done">("idle");
  const [progress, setProgress] = useState({ pushed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<{
    list_id: string;
    list_name: string;
  } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName ?? defaultName());
    setError(null);
    setWarning(null);
    setResult(null);
    setProgress({ pushed: 0, total: 0 });
    setPhase("idle");
    cancelledRef.current = false;
  }, [open, suggestedName]);

  // Pre-dedup + validate on the client so the progress numbers and the
  // server's view agree.
  const validContacts = (() => {
    const seen = new Set<string>();
    const out: Contact[] = [];
    for (const c of contacts) {
      const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: c.name });
    }
    return out;
  })();

  const submit = async () => {
    if (!name.trim()) {
      setError("Informe um nome para a lista.");
      return;
    }
    if (validContacts.length === 0) {
      setError("Nenhum dos contatos selecionados tem email válido.");
      return;
    }

    setError(null);
    setWarning(null);
    cancelledRef.current = false;

    // Phase 1: create the list (no contacts yet).
    setPhase("creating");
    let listId: string;
    let listName: string;
    try {
      const r = await fetch("/api/crm/email-templates/locaweb/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({ name: name.trim(), contacts: [] }),
      });
      const text = await r.text();
      let d: unknown;
      try {
        d = JSON.parse(text);
      } catch {
        throw new Error(`Resposta inesperada (HTTP ${r.status})`);
      }
      const data = d as { list_id?: string; list_name?: string; error?: string };
      if (!r.ok || !data.list_id) throw new Error(data.error ?? "Falha ao criar lista.");
      listId = data.list_id;
      listName = data.list_name ?? name.trim();
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
      return;
    }

    // Phase 2: parallel chunked upload. Build all chunks up front, then
    // process them with a bounded concurrency pool. Each chunk-fetch
    // takes ~10s on Locaweb (140ms × 75 contacts), so 4 parallel cuts
    // wall-clock by ~4× without tripping Locaweb rate limits.
    setPhase("uploading");
    setProgress({ pushed: 0, total: validContacts.length });

    const chunks: Contact[][] = [];
    for (let i = 0; i < validContacts.length; i += CHUNK_SIZE) {
      chunks.push(validContacts.slice(i, i + CHUNK_SIZE));
    }

    let pushed = 0;
    let firstError: string | null = null;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        if (cancelledRef.current || firstError) return;
        const idx = nextIndex++;
        if (idx >= chunks.length) return;
        const chunk = chunks[idx];
        try {
          const r = await fetch(
            `/api/crm/email-templates/locaweb/lists/${encodeURIComponent(listId)}/contacts`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-workspace-id": workspaceId,
              },
              body: JSON.stringify({ contacts: chunk }),
            }
          );
          const text = await r.text();
          let d: unknown;
          try {
            d = JSON.parse(text);
          } catch {
            throw new Error(`Resposta inesperada (HTTP ${r.status})`);
          }
          const data = d as { ok?: boolean; pushed?: number; error?: string };
          if (!r.ok || !data.ok) throw new Error(data.error ?? "Falha ao enviar lote.");
          pushed += chunk.length;
          setProgress({ pushed, total: validContacts.length });
        } catch (err) {
          // First failure short-circuits the remaining workers. The list
          // still exists with whatever already made it through; Locaweb
          // dedups on add so retrying the same filter is safe.
          if (!firstError) firstError = (err as Error).message;
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (firstError && pushed < validContacts.length) {
      setWarning(
        `Falha parcial: ${pushed.toLocaleString("pt-BR")}/${validContacts.length.toLocaleString(
          "pt-BR"
        )} contatos enviados — ${firstError}`
      );
    }

    if (pushed === 0) {
      // Nothing made it through — surface as a hard error rather than a
      // misleading "lista criada" success. The empty list is left in the
      // panel; user can delete it manually.
      setError(
        firstError
          ? `Lista criada mas nenhum contato foi enviado: ${firstError}`
          : "Lista criada mas nenhum contato foi enviado."
      );
      setPhase("idle");
      return;
    }

    setResult({ list_id: listId, list_name: listName });
    setPhase("done");
  };

  const close = () => {
    if (phase === "creating" || phase === "uploading") {
      cancelledRef.current = true;
    }
    onOpenChange(false);
  };

  const isWorking = phase === "creating" || phase === "uploading";
  const progressPct =
    progress.total > 0 ? Math.round((progress.pushed / progress.total) * 100) : 0;

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

        {phase === "done" && result ? (
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
                  {progress.pushed.toLocaleString("pt-BR")} de{" "}
                  {progress.total.toLocaleString("pt-BR")} contatos enviados.
                </div>
                {warning && (
                  <div className="text-amber-700 dark:text-amber-300 mt-1 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    {warning}
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
                  {validContacts.length.toLocaleString("pt-BR")} contato
                  {validContacts.length === 1 ? "" : "s"} com email válido
                </div>
                {validContacts.length < contacts.length && (
                  <div className="text-[10px] text-muted-foreground">
                    {(contacts.length - validContacts.length).toLocaleString("pt-BR")}{" "}
                    sem email serão ignorados.
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
                disabled={isWorking}
                className="h-9 text-sm"
                placeholder="Ex: RFM Champions · Noite"
                maxLength={120}
              />
              <p className="text-[10px] text-muted-foreground">
                Esse nome aparece no painel da Locaweb e na seleção de listas
                ao disparar.
              </p>
            </div>

            {phase === "uploading" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Enviando contatos para Locaweb...
                  </span>
                  <span className="font-mono tabular-nums">
                    {progress.pushed.toLocaleString("pt-BR")} /{" "}
                    {progress.total.toLocaleString("pt-BR")} ({progressPct}%)
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {phase === "creating" && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Criando lista na Locaweb...
              </div>
            )}

            {error && (
              <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
                {error}
              </div>
            )}

            {warning && phase !== "done" && (
              <div className="text-xs text-amber-700 dark:text-amber-300 p-2 border border-amber-300/40 rounded bg-amber-50 dark:bg-amber-900/10">
                {warning}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={close}>
                {isWorking ? "Cancelar" : "Fechar"}
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={isWorking || !name.trim() || validContacts.length === 0}
                className="gap-1.5"
              >
                {isWorking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                {phase === "creating"
                  ? "Criando lista..."
                  : phase === "uploading"
                    ? `Enviando ${progressPct}%`
                    : `Criar lista (${validContacts.length.toLocaleString("pt-BR")})`}
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
