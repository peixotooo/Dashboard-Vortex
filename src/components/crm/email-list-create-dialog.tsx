"use client";

// EmailListCreateDialog — turns a filtered customer set from the CRM page
// into a Locaweb email-marketing list, using Locaweb's async
// /contact_imports endpoint. End-to-end for 7k contacts: ~10 seconds.
//
// Three phases:
//   1. creating  — POST /lists with no contacts → list_id (~1s)
//   2. uploading — POST /lists/{id}/bulk-import → server builds CSV,
//                  uploads to Supabase Storage, calls Locaweb. Returns
//                  import_id (~1-2s)
//   3. importing — poll GET /imports/{id} every 2s. Locaweb reports
//                  total_lines / created_count / errors_count in real
//                  time, so the progress bar reflects actual work.
//
// Crucial body shape gotcha (see lib/locaweb/email-marketing.ts):
// `contact_import` wrapper accepts ONLY `list_ids` + `url`. Any other
// field (name, description, has_header) triggers a 500 from Locaweb.

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
  suggestedName?: string;
}

type Phase = "idle" | "creating" | "uploading" | "importing" | "done";

interface ImportStatusResponse {
  id: number | string;
  status: "processing" | "finished" | "error";
  raw_status: string;
  list_ids: Array<number | string>;
  total_lines: number | null;
  created_count: number | null;
  updated_count: number | null;
  errors_count: number | null;
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [importStatus, setImportStatus] = useState<ImportStatusResponse | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<{
    list_id: string;
    list_name: string;
    created: number;
    updated: number;
    errors: number;
  } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName ?? defaultName());
    setError(null);
    setWarning(null);
    setResult(null);
    setImportStatus(null);
    setTotalToImport(0);
    setPhase("idle");
    cancelledRef.current = false;
  }, [open, suggestedName]);

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
    setTotalToImport(validContacts.length);

    // 1. Create the empty list
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

    if (cancelledRef.current) return;

    // 2. Kick off the bulk import (server uploads CSV + calls Locaweb)
    setPhase("uploading");
    let importId: string;
    try {
      const r = await fetch(
        `/api/crm/email-templates/locaweb/lists/${encodeURIComponent(listId)}/bulk-import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
          body: JSON.stringify({ contacts: validContacts }),
        }
      );
      const text = await r.text();
      let d: unknown;
      try {
        d = JSON.parse(text);
      } catch {
        throw new Error(`Resposta inesperada (HTTP ${r.status})`);
      }
      const data = d as { import_id?: string; error?: string };
      if (!r.ok || !data.import_id) throw new Error(data.error ?? "Falha ao iniciar importação.");
      importId = data.import_id;
    } catch (err) {
      setError(`Lista criada mas a importação não começou: ${(err as Error).message}`);
      setPhase("idle");
      return;
    }

    if (cancelledRef.current) return;

    // 3. Poll Locaweb's import status
    setPhase("importing");
    const pollUrl = `/api/crm/email-templates/locaweb/imports/${encodeURIComponent(importId)}`;
    const start = Date.now();
    while (true) {
      if (cancelledRef.current) return;
      if (Date.now() - start > 5 * 60_000) {
        setError("Importação demorou mais que 5 minutos sem finalizar.");
        setPhase("idle");
        return;
      }
      let status: ImportStatusResponse;
      try {
        const r = await fetch(pollUrl, { headers: { "x-workspace-id": workspaceId } });
        const text = await r.text();
        const d = JSON.parse(text) as ImportStatusResponse & { error?: string };
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        status = d;
      } catch (err) {
        setWarning(`Falha ao consultar status: ${(err as Error).message}`);
        await sleep(3000);
        continue;
      }
      setImportStatus(status);

      if (status.status === "finished") {
        setResult({
          list_id: listId,
          list_name: listName,
          created: status.created_count ?? 0,
          updated: status.updated_count ?? 0,
          errors: status.errors_count ?? 0,
        });
        setPhase("done");
        return;
      }
      if (status.status === "error") {
        setError(
          `Locaweb reportou erro ao processar a importação (status: ${status.raw_status}).`
        );
        setPhase("idle");
        return;
      }
      await sleep(2000);
    }
  };

  const close = () => {
    if (phase === "creating" || phase === "uploading" || phase === "importing") {
      cancelledRef.current = true;
    }
    onOpenChange(false);
  };

  const isWorking = phase === "creating" || phase === "uploading" || phase === "importing";

  const processed =
    (importStatus?.created_count ?? 0) +
    (importStatus?.errors_count ?? 0) +
    (importStatus?.updated_count ?? 0);
  const total = importStatus?.total_lines || totalToImport;
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Criar lista de email (Locaweb)
        </DialogTitle>
        <DialogDescription className="text-xs">
          A lista é importada de forma assíncrona via CSV. 7k contatos
          finalizam em torno de 10 segundos.
        </DialogDescription>

        {phase === "done" && result ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-medium text-emerald-700 dark:text-emerald-300">
                  Lista importada
                </div>
                <div className="text-muted-foreground">
                  <span className="font-mono">{result.list_name}</span> · id{" "}
                  <span className="font-mono">{result.list_id}</span>
                </div>
                <div className="text-muted-foreground">
                  {result.created.toLocaleString("pt-BR")} criado
                  {result.created === 1 ? "" : "s"}
                  {result.updated > 0 && (
                    <>
                      {" · "}
                      {result.updated.toLocaleString("pt-BR")} já existia
                      {result.updated === 1 ? "" : "m"} (atualizado
                      {result.updated === 1 ? "" : "s"})
                    </>
                  )}
                  {result.errors > 0 && (
                    <>
                      {" · "}
                      <span className="text-amber-700 dark:text-amber-300">
                        {result.errors.toLocaleString("pt-BR")} erro
                        {result.errors === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </div>
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

            {phase === "creating" && (
              <PhaseRow label="Criando lista na Locaweb..." />
            )}
            {phase === "uploading" && (
              <PhaseRow label="Subindo CSV e enfileirando importação..." />
            )}
            {phase === "importing" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Locaweb processando ({importStatus?.raw_status ?? "..."})
                  </span>
                  <span className="font-mono tabular-nums">
                    {importStatus?.total_lines
                      ? `${processed.toLocaleString("pt-BR")} / ${total.toLocaleString("pt-BR")} (${progressPct}%)`
                      : "aguardando..."}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {importStatus?.errors_count != null && importStatus.errors_count > 0 && (
                  <div className="text-[10px] text-amber-700 dark:text-amber-300">
                    {importStatus.errors_count.toLocaleString("pt-BR")} erro(s)
                    reportados pela Locaweb (linhas inválidas).
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
                {error}
              </div>
            )}

            {warning && phase !== "done" && (
              <div className="text-xs text-amber-700 dark:text-amber-300 p-2 border border-amber-300/40 rounded bg-amber-50 dark:bg-amber-900/10 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
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
                  ? "Criando..."
                  : phase === "uploading"
                    ? "Enviando CSV..."
                    : phase === "importing"
                      ? `Importando ${progressPct}%`
                      : `Criar lista (${validContacts.length.toLocaleString("pt-BR")})`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhaseRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      {label}
    </div>
  );
}

function defaultName(): string {
  const d = new Date();
  return `CRM · ${d.toISOString().slice(0, 10)}`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
