"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ListChecks,
  Upload,
  Loader2,
  Plus,
  Trash2,
  MessageCircle,
  Mail,
  Phone,
  Users,
  AlertCircle,
  CheckCircle2,
  Eye,
  MapPin,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import {
  parseCsv,
  autoMapColumns,
  applyMapping,
  type ColumnMapping,
  type ContactField,
  type ParsedCsv,
  type ParsedContact,
} from "@/lib/crm/csv-contacts";
import { EmailListCreateDialog } from "@/components/crm/email-list-create-dialog";

type AutoSegment =
  | { type: "gender"; gender: "female" | "male"; min_confidence: "high" | "medium" }
  | { type: "state"; state: string }
  | {
      type: "retention_playbook";
      role?: "treatment" | "holdout";
      run_id?: string;
      playbook_id?: string;
      playbook_name?: string;
      holdout_pct?: number;
      created_at?: string;
    };

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  total_count: number;
  phone_count: number;
  email_count: number;
  locaweb_list_id: string | null;
  auto_segment: AutoSegment | null;
  created_at: string;
  updated_at: string;
}

const BR_STATES: Array<{ uf: string; name: string }> = [
  { uf: "AC", name: "Acre" }, { uf: "AL", name: "Alagoas" }, { uf: "AP", name: "Amapá" },
  { uf: "AM", name: "Amazonas" }, { uf: "BA", name: "Bahia" }, { uf: "CE", name: "Ceará" },
  { uf: "DF", name: "Distrito Federal" }, { uf: "ES", name: "Espírito Santo" },
  { uf: "GO", name: "Goiás" }, { uf: "MA", name: "Maranhão" }, { uf: "MT", name: "Mato Grosso" },
  { uf: "MS", name: "Mato Grosso do Sul" }, { uf: "MG", name: "Minas Gerais" },
  { uf: "PA", name: "Pará" }, { uf: "PB", name: "Paraíba" }, { uf: "PR", name: "Paraná" },
  { uf: "PE", name: "Pernambuco" }, { uf: "PI", name: "Piauí" }, { uf: "RJ", name: "Rio de Janeiro" },
  { uf: "RN", name: "Rio Grande do Norte" }, { uf: "RS", name: "Rio Grande do Sul" },
  { uf: "RO", name: "Rondônia" }, { uf: "RR", name: "Roraima" },
  { uf: "SC", name: "Santa Catarina" }, { uf: "SP", name: "São Paulo" },
  { uf: "SE", name: "Sergipe" }, { uf: "TO", name: "Tocantins" },
];

interface DetailList extends ContactList {
  contacts: ParsedContact[];
}

interface RetentionEmailContext {
  runId: string;
  playbookId: string;
  playbookName: string;
  audienceName: string;
}

const FIELD_LABEL: Record<ContactField, string> = {
  name: "Nome",
  phone: "Telefone",
  email: "Email",
  ignore: "Ignorar",
};

export default function ContactListsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [stateDialogOpen, setStateDialogOpen] = useState(false);
  const [detailList, setDetailList] = useState<DetailList | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  // Dialog "promover pro Locaweb"
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailContacts, setEmailContacts] = useState<{ email: string; name?: string }[]>([]);
  const [emailListName, setEmailListName] = useState<string>("");
  const [emailRetentionContext, setEmailRetentionContext] = useState<RetentionEmailContext | null>(null);

  const wsHeaders = useCallback(
    (): HeadersInit => ({
      "x-workspace-id": workspaceId,
      "Content-Type": "application/json",
    }),
    [workspaceId]
  );

  const fetchLists = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/contact-lists", {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setLists(data.lists || []);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  function emailContextFromList(
    list: DetailList,
    fallback?: RetentionEmailContext
  ): RetentionEmailContext | null {
    if (fallback) return fallback;
    const auto = list.auto_segment;
    if (auto?.type !== "retention_playbook") return null;
    return {
      runId: auto.run_id || "",
      playbookId: auto.playbook_id || "",
      playbookName: auto.playbook_name || "Playbook de retencao",
      audienceName: list.name,
    };
  }

  function emailTemplatesHref(
    listId: string,
    context: RetentionEmailContext | null,
    listName: string
  ): string {
    const params = new URLSearchParams({
      list: listId,
      audience: context?.audienceName || listName,
      playbook: context?.playbookName || "Playbook de retencao",
    });
    if (context?.playbookId) params.set("playbook_id", context.playbookId);
    if (context?.runId) params.set("run", context.runId);
    return `/crm/email-templates?${params.toString()}`;
  }

  function redirectToEmailTemplates(
    listId: string,
    list: DetailList,
    context?: RetentionEmailContext | null
  ) {
    window.location.href = emailTemplatesHref(listId, context ?? emailContextFromList(list), list.name);
  }

  async function openDetail(id: string, opts?: { openEmail?: boolean; emailContext?: RetentionEmailContext }) {
    try {
      const res = await fetch(`/api/crm/contact-lists/${id}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setDetailList(data.list);
      if (opts?.openEmail) {
        const context = emailContextFromList(data.list, opts.emailContext);
        if (data.list.locaweb_list_id && context) {
          redirectToEmailTemplates(data.list.locaweb_list_id, data.list, context);
        } else {
          openEmailDialog(data.list, context);
        }
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    }
  }

  async function deleteList(l: ContactList) {
    if (!confirm(`Excluir a lista "${l.name}"? Esta ação é irreversível.`)) return;
    setDeleteBusyId(l.id);
    try {
      const res = await fetch(`/api/crm/contact-lists/${l.id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro");
      await fetchLists();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setDeleteBusyId(null);
    }
  }

  function openEmailDialog(l: DetailList, context?: RetentionEmailContext | null) {
    const emails = l.contacts
      .filter((c) => c.email)
      .map((c) => ({ email: c.email!, name: c.name }));
    if (emails.length === 0) {
      alert("Esta lista não tem contatos com email.");
      return;
    }
    setEmailContacts(emails);
    setEmailListName(l.name);
    setEmailRetentionContext(context ?? emailContextFromList(l));
    setEmailDialogOpen(true);
  }

  const handledQueryRef = useRef(false);
  useEffect(() => {
    if (!workspaceId || handledQueryRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const emailListId = params.get("email");
    const listId = emailListId || params.get("list");
    if (!listId) return;

    handledQueryRef.current = true;
    const emailContext = {
      runId: params.get("run") || "",
      playbookId: params.get("playbook") || "",
      playbookName: params.get("playbook_name") || "Playbook de retencao",
      audienceName: params.get("audience") || "Lista de tratamento",
    };
    const hasEmailContext = Boolean(
      emailContext.runId ||
        emailContext.playbookId ||
        params.get("playbook_name") ||
        params.get("audience")
    );
    openDetail(listId, {
      openEmail: Boolean(emailListId),
      emailContext: emailListId && hasEmailContext ? emailContext : undefined,
    });
    params.delete("email");
    params.delete("list");
    params.delete("run");
    params.delete("playbook");
    params.delete("playbook_name");
    params.delete("audience");
    const url = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="h-6 w-6" />
            Listas de Contatos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Suba um CSV pra criar listas personalizadas. Use no disparo de WhatsApp e Email.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStateDialogOpen(true)} title="Cria uma lista auto-alimentada por UF do pedido">
            <MapPin className="h-4 w-4 mr-2" /> Lista por estado
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nova lista (CSV)
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Nenhuma lista ainda.</p>
            <p className="text-xs mt-1">Suba um CSV pra criar a primeira.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lists.map((l) => (
            <Card key={l.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{l.name}</span>
                    <Badge variant="outline">
                      <Users className="h-3 w-3 mr-1" /> {l.total_count}
                    </Badge>
                    {l.phone_count > 0 && (
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                        <Phone className="h-3 w-3 mr-1" /> {l.phone_count}
                      </Badge>
                    )}
                    {l.email_count > 0 && (
                      <Badge variant="outline" className="border-sky-500/30 text-sky-400">
                        <Mail className="h-3 w-3 mr-1" /> {l.email_count}
                      </Badge>
                    )}
                    {l.locaweb_list_id && (
                      <Badge variant="outline" className="border-purple-500/30 text-purple-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> No Locaweb
                      </Badge>
                    )}
                    {l.auto_segment && (
                      <Badge variant="outline" className="border-amber-500/30 text-amber-400" title="Lista alimentada automaticamente a cada pedido confirmado">
                        <RefreshCw className="h-3 w-3 mr-1" /> Auto
                      </Badge>
                    )}
                  </div>
                  {l.description && (
                    <p className="text-xs text-muted-foreground mt-1">{l.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Criada em{" "}
                    {new Date(l.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => openDetail(l.id)}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" /> Ver
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteBusyId === l.id}
                    onClick={() => deleteList(l)}
                  >
                    {deleteBusyId === l.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        wsHeaders={wsHeaders}
        onCreated={fetchLists}
      />

      <StateListDialog
        open={stateDialogOpen}
        onOpenChange={setStateDialogOpen}
        wsHeaders={wsHeaders}
        onCreated={fetchLists}
      />

      <Dialog open={!!detailList} onOpenChange={(open) => !open && setDetailList(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailList?.name}</DialogTitle>
            <DialogDescription>
              {detailList && (
                <>
                  {detailList.total_count} contato(s) — {detailList.phone_count} com telefone,{" "}
                  {detailList.email_count} com email
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {detailList && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openEmailDialog(detailList)}
                  disabled={detailList.email_count === 0}
                  title={
                    detailList.email_count === 0
                      ? "Sem emails nesta lista"
                      : detailList.locaweb_list_id
                      ? "Lista já existe no Locaweb — disponibilizar de novo cria uma nova"
                      : "Cria uma lista no Locaweb pra disparo via Email Templates"
                  }
                >
                  <Mail className="h-3.5 w-3.5" />
                  {detailList.locaweb_list_id ? "Recriar no Locaweb" : "Disponibilizar pro Email"}
                </Button>
                <a
                  href={`/crm/whatsapp?list=${detailList.id}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border bg-background hover:bg-accent text-sm"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Usar no WhatsApp
                </a>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs">
                    <tr>
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">Telefone</th>
                      <th className="px-3 py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailList.contacts.slice(0, 200).map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{c.name || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{c.phone || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{c.email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detailList.contacts.length > 200 && (
                  <p className="text-xs text-muted-foreground p-2 border-t bg-muted/30">
                    Mostrando 200 de {detailList.contacts.length} contatos.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

<EmailListCreateDialog
        open={emailDialogOpen}
        onOpenChange={(open) => {
          setEmailDialogOpen(open);
          if (!open) {
            // depois que o dialog fechar, refaz fetch (pode ter criado lista nova)
            fetchLists();
            setEmailRetentionContext(null);
          }
        }}
        contacts={emailContacts}
        suggestedName={emailListName}
        onCreated={async ({ listId }) => {
          if (!detailList) return;
          await fetch(`/api/crm/contact-lists/${detailList.id}`, {
            method: "PATCH",
            headers: wsHeaders(),
            body: JSON.stringify({ locaweb_list_id: listId }),
          }).catch(() => {});
          setDetailList((prev) => prev && { ...prev, locaweb_list_id: listId });
          if (emailRetentionContext) {
            redirectToEmailTemplates(listId, detailList, emailRetentionContext);
          }
        }}
      />
    </div>
  );
}

// =================================================================
// Upload dialog (CSV + column mapping + name)
// =================================================================

function UploadDialog({
  open,
  onOpenChange,
  wsHeaders,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsHeaders: () => HeadersInit;
  onCreated: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setParsed(null);
      setMapping(null);
      setName("");
      setDescription("");
      setError(null);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [open]);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const p = parseCsv(text);
      if (p.rows.length === 0) {
        setError("CSV vazio ou inválido.");
        return;
      }
      setParsed(p);
      setMapping(autoMapColumns(p));
      if (!name) setName(file.name.replace(/\.csv$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro lendo CSV.");
    }
  }

  const preview: ParsedContact[] = parsed && mapping ? applyMapping(parsed, mapping) : [];

  async function submit() {
    if (!parsed || !mapping) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Dê um nome pra lista.");
      return;
    }
    const contacts = applyMapping(parsed, mapping);
    if (contacts.length === 0) {
      setError("Nenhum contato válido. Confira o mapeamento de colunas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/contact-lists", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || null,
          contacts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setBusy(false);
    }
  }

  function setColumn(idx: number, field: ContactField) {
    if (!mapping) return;
    const next: Record<number, ContactField> = { ...mapping.byIndex };
    // Garante exclusividade: se outro index tinha esse field, libera
    if (field !== "ignore") {
      for (const k of Object.keys(next)) {
        if (next[Number(k)] === field && Number(k) !== idx) {
          next[Number(k)] = "ignore";
        }
      }
    }
    next[idx] = field;
    setMapping({ byIndex: next });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova lista de contatos</DialogTitle>
          <DialogDescription>
            Suba um arquivo .csv. As colunas são detectadas automaticamente — ajuste se precisar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!parsed ? (
            <div className="border-2 border-dashed rounded-lg p-10 text-center">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-3">
                Aceita .csv com qualquer ordem de colunas. Cada linha precisa ter ao menos telefone ou email.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Escolher CSV
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome da lista</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Black Friday VIP"
                  />
                </div>
                <div>
                  <Label>Descrição (opcional)</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Pra que serve essa lista"
                  />
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Mapeamento de colunas</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Detectamos os campos automaticamente. Ajuste se necessário — colunas marcadas como &ldquo;Ignorar&rdquo; não são importadas.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {parsed.headers.map((header, idx) => (
                    <div key={idx} className="flex items-center gap-2 border rounded-md px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">
                          Coluna {idx + 1}
                        </p>
                        <p className="text-sm truncate">{header}</p>
                        <p className="text-[11px] text-muted-foreground truncate font-mono">
                          {parsed.rows[0]?.[idx] || "—"}
                        </p>
                      </div>
                      <Select
                        value={mapping?.byIndex[idx] || "ignore"}
                        onValueChange={(v) => setColumn(idx, v as ContactField)}
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["name", "phone", "email", "ignore"] as ContactField[]).map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABEL[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Preview ({preview.length} linha(s) válida(s))</Label>
                <div className="border rounded-md overflow-hidden text-sm">
                  <table className="w-full">
                    <thead className="bg-muted/50 text-left text-xs">
                      <tr>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Telefone</th>
                        <th className="px-3 py-2">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 5).map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{c.name || "—"}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{c.phone || "—"}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{c.email || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3">
                      Nenhuma linha foi mapeada. Confira se ao menos uma coluna está marcada como Telefone ou Email.
                    </p>
                  )}
                </div>
              </div>

</>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {parsed && (
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setParsed(null);
                  setMapping(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                disabled={busy}
              >
                Trocar arquivo
              </Button>
              <Button className="flex-1" onClick={submit} disabled={busy || preview.length === 0}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Criar lista ({preview.length} contatos)
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// Dialog: criar lista auto-segmentada por UF do pedido
// =================================================================

function StateListDialog({
  open,
  onOpenChange,
  wsHeaders,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsHeaders: () => HeadersInit;
  onCreated: () => void;
}) {
  const [uf, setUf] = useState<string>("SP");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    name: string;
    created: boolean;
    appended: number;
    duplicate: number;
    scanned: number;
  } | null>(null);

  function close() {
    if (busy) return;
    setErrorMsg(null);
    setLastResult(null);
    onOpenChange(false);
  }

  async function materialize() {
    setBusy(true);
    setErrorMsg(null);
    setLastResult(null);
    try {
      const res = await fetch("/api/crm/segments/state/materialize", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ state: uf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setLastResult({
        name: data.list.name,
        created: data.list.created,
        appended: data.seed.appended,
        duplicate: data.seed.duplicate,
        scanned: data.seed.scanned,
      });
      onCreated();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erro de rede");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lista por estado</DialogTitle>
          <DialogDescription>
            Cria uma lista alimentada automaticamente a cada pedido confirmado
            cujo endereço de entrega está na UF escolhida. A lista cresce sozinha
            via webhook — sem precisar re-upload.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="uf-select">Estado</Label>
            <Select value={uf} onValueChange={setUf}>
              <SelectTrigger id="uf-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {BR_STATES.map((s) => (
                  <SelectItem key={s.uf} value={s.uf}>
                    {s.name} ({s.uf})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              No clique abaixo a gente cria a lista e popula com todos os clientes
              que já tiveram pedido com esse estado em <code>crm_vendas</code>.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {lastResult && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {lastResult.created ? "Lista criada" : "Lista atualizada"}
              </div>
              <p className="text-xs">
                {lastResult.name} — {lastResult.appended} novos + {lastResult.duplicate} já presentes
                (escaneado {lastResult.scanned} pedidos).
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Fechar
            </Button>
            <Button onClick={materialize} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4 mr-2" />
              )}
              Criar / atualizar lista
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
