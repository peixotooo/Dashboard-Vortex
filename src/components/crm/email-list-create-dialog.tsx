"use client";

// EmailListCreateDialog — turns a filtered customer set from the CRM page
// into a Locaweb email-marketing list.
//
// Strategy: Locaweb's per-contact `add` is brutally slow (~140ms each;
// 1000 contacts already 504s server-side). Instead of chunking, we use
// their async import flow — upload a CSV to Supabase Storage, hand
// Locaweb the URL, poll the resulting import_id until it's done. End-
// to-end for 7k contacts: ~10 seconds.
//
// Phases:
//   1. creating  — POST /lists with empty contacts → list_id (~1s)
//   2. uploading — POST /lists/{id}/bulk-import { contacts } → import_id
//                  (the server builds CSV, uploads to storage, kicks off
//                  Locaweb)
//   3. importing — poll GET /imports/{id} every 2s until status =
//                  finished / error. Locaweb reports total / created /
//                  errors counts so the progress bar reflects real work.

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

type Phase = "idle" | "creating" | "uploading" | "importing" | "done";

interface ImportStatusResponse {
  id: number | string;
  status: "processing" | "finished" | "error";
  raw_status: string;
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

    // Phase 1: create the empty list.
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

    // Phase 2: kick off the bulk import. If the /bulk-import call times
    // out on Vercel (504, HTML response, etc) the import almost
    // certainly did reach Locaweb's queue anyway — Vercel kills our
    // function but the upstream HTTP call already completed. We fall
    // back to listing the workspace's recent imports and matching by
    // the list_id (encoded in the CSV file path) to recover the
    // import_id.
    setPhase("uploading");
    const phase2Started = Date.now();
    let importId: string | null = null;
    let phase2Error: string | null = null;
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
        // Vercel timeout returns an HTML 504 page. We'll try the
        // fallback below.
        throw new Error(`Resposta inesperada (HTTP ${r.status})`);
      }
      const data = d as { import_id?: string; error?: string };
      if (!r.ok || !data.import_id) throw new Error(data.error ?? "Falha ao iniciar importação.");
      importId = data.import_id;
    } catch (err) {
      phase2Error = (err as Error).message;
    }

    if (cancelledRef.current) return;

    if (!importId) {
      // Fallback: poll Locaweb's import history for an entry created
      // after we started phase 2 whose URL contains our list_id and
      // workspace_id. Try a few times since Locaweb's queue may take a
      // second to register the import.
      setWarning(
        "A primeira chamada falhou (provavelmente timeout do Vercel). Procurando o import na Locaweb..."
      );
      const candidate = await findRecentImport({
        workspaceId,
        listId,
        startedAtMs: phase2Started,
      });
      if (candidate) {
        importId = candidate;
        setWarning(null);
      } else {
        setError(
          `Lista criada mas a importação não começou: ${phase2Error ?? "erro desconhecido"}`
        );
        setPhase("idle");
        return;
      }
    }

    if (cancelledRef.current) return;

    // Phase 3: poll the Locaweb import status until it settles. Locaweb
    // returns total_lines / created_count / errors_count as the file is
    // being chewed through, so we can drive a real progress bar.
    setPhase("importing");
    const pollUrl = `/api/crm/email-templates/locaweb/imports/${encodeURIComponent(importId)}`;
    const start = Date.now();
    while (true) {
      if (cancelledRef.current) return;
      // Cap at 5 min — anything slower is genuinely stuck.
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

  // Progress numbers come from Locaweb during the import phase; before
  // that, we just show the count we're about to ship.
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
          A lista vai ser criada na Locaweb com os contatos selecionados via
          importação assíncrona — bem mais rápido que add contato a contato.
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
                  {result.created.toLocaleString("pt-BR")} contato
                  {result.created === 1 ? "" : "s"} adicionado
                  {result.created === 1 ? "" : "s"}
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
                    Locaweb processando importação...
                  </span>
                  <span className="font-mono tabular-nums">
                    {importStatus?.total_lines
                      ? `${processed.toLocaleString("pt-BR")} / ${total.toLocaleString("pt-BR")} (${progressPct}%)`
                      : "aguardando primeiro retorno..."}
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

interface ImportListItem {
  id: number | string;
  url?: string;
  status: "processing" | "finished" | "error";
  created_at?: string | null;
}

/**
 * Look up Locaweb's import history for an entry created after the dialog
 * started phase 2 whose CSV URL is scoped to our list. Used as a
 * fallback when the /bulk-import POST 504s on Vercel — the Locaweb call
 * almost certainly went through, we just lost the response.
 */
async function findRecentImport(args: {
  workspaceId: string;
  listId: string;
  startedAtMs: number;
}): Promise<string | null> {
  // Try a few times, each separated by 2s. Locaweb's queue can take a
  // moment to register the import after createContactImport responds.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? 1000 : 2000);
    try {
      const r = await fetch("/api/crm/email-templates/locaweb/imports", {
        headers: { "x-workspace-id": args.workspaceId },
      });
      if (!r.ok) continue;
      const d = (await r.json()) as { items?: ImportListItem[] };
      const items = d.items ?? [];
      // Match URLs that came out of our bulk-import endpoint:
      //   .../email-list-imports/<workspace>/<list_id>-<ts>-<rand>.csv
      const needle = `/${args.workspaceId}/${args.listId}-`;
      const match = items.find(
        (it) => typeof it.url === "string" && it.url.includes(needle)
      );
      if (match) return String(match.id);
    } catch {
      // ignore, retry
    }
  }
  return null;
}
