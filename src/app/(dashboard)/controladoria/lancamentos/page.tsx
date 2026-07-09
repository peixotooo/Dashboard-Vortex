"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Plus, Pencil, Trash2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { fmtDateBR } from "@/lib/controladoria/format";

type Row = {
  id: string;
  doc_number: string | null;
  description: string | null;
  observation: string | null;
  competence_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  amount: number;
  flow: 1 | -1;
  kind: string;
  needs_review: boolean;
  source: string;
  partner: { id: string; name: string } | null;
  classification: { id: string; path: string; name: string; category: string } | null;
  account: { id: string; code: string } | null;
};

type Meta = {
  classifications: { id: string; path: string; name: string; category: string; flow: number; is_active: boolean }[];
  accounts: { id: string; code: string; bank_name: string | null }[];
};

type FormState = {
  id?: string;
  doc_number: string;
  description: string;
  partner_name: string;
  classification_id: string;
  bank_account_id: string;
  competence_date: string;
  due_date: string;
  paid: boolean;
  paid_at: string;
  amount: string;
  observation: string;
};

const EMPTY_FORM: FormState = {
  doc_number: "", description: "", partner_name: "", classification_id: "",
  bank_account_id: "", competence_date: "", due_date: "", paid: false, paid_at: "",
  amount: "", observation: "",
};

export default function LancamentosPage() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<Meta | null>(null);

  // filtros
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("todos");
  const [clsFilter, setClsFilter] = React.useState("all");
  const [accFilter, setAccFilter] = React.useState("all");
  const [dueFrom, setDueFrom] = React.useState("");
  const [dueTo, setDueTo] = React.useState("");

  // form
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);

  const headers = React.useMemo(
    () => ({ "x-workspace-id": workspace?.id ?? "", "Content-Type": "application/json" }),
    [workspace?.id]
  );

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (status !== "todos") params.set("status", status);
      if (clsFilter !== "all") params.set("classification_id", clsFilter);
      if (accFilter !== "all") params.set("account_id", accFilter);
      if (dueFrom) params.set("due_from", dueFrom);
      if (dueTo) params.set("due_to", dueTo);
      const res = await fetch(`/api/controladoria/lancamentos?${params}`, {
        headers: { "x-workspace-id": workspace.id },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.rows);
      setTotal(json.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, q, status, clsFilter, accFilter, dueFrom, dueTo]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!workspace?.id) return;
    void fetch("/api/controladoria/meta", { headers: { "x-workspace-id": workspace.id }, cache: "no-store" })
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => null);
  }, [workspace?.id]);

  const togglePaid = async (row: Row) => {
    if (!workspace?.id) return;
    const paid_at = row.paid_at ? null : new Date().toISOString().slice(0, 10);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, paid_at } : r)));
    await fetch(`/api/controladoria/lancamentos/${row.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ paid_at }),
    });
  };

  const remove = async (row: Row) => {
    if (!workspace?.id) return;
    if (!confirm(`Excluir o lançamento de ${formatCurrency(row.amount)} (${row.classification?.name ?? "?"})? Ele vai para a lixeira.`)) return;
    await fetch(`/api/controladoria/lancamentos/${row.id}`, { method: "DELETE", headers });
    void load();
  };

  const openEdit = (row: Row) => {
    setForm({
      id: row.id,
      doc_number: row.doc_number ?? "",
      description: row.description ?? "",
      partner_name: row.partner?.name ?? "",
      classification_id: row.classification?.id ?? "",
      bank_account_id: row.account?.id ?? "",
      competence_date: row.competence_date ?? "",
      due_date: row.due_date ?? "",
      paid: !!row.paid_at,
      paid_at: row.paid_at ?? "",
      amount: String(row.amount),
      observation: row.observation ?? "",
    });
  };

  const save = async () => {
    if (!form || !workspace?.id) return;
    setSaving(true);
    try {
      const payload = {
        doc_number: form.doc_number || null,
        description: form.description || null,
        observation: form.observation || null,
        partner_name: form.partner_name || null,
        classification_id: form.classification_id,
        bank_account_id: form.bank_account_id || null,
        competence_date: form.competence_date || null,
        due_date: form.due_date || null,
        paid_at: form.paid ? (form.paid_at || new Date().toISOString().slice(0, 10)) : null,
        amount: parseFloat(form.amount.replace(",", ".")),
      };
      const res = form.id
        ? await fetch(`/api/controladoria/lancamentos/${form.id}`, { method: "PATCH", headers, body: JSON.stringify(payload) })
        : await fetch(`/api/controladoria/lancamentos`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setForm(null);
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const head = "vencimento;competencia;parceiro;descricao;valor;tipo;classificacao;conta;pago_em";
    const lines = rows.map((r) =>
      [r.due_date ?? "", r.competence_date ?? "", r.partner?.name ?? "", (r.description ?? "").replace(/;/g, ","),
        String(r.amount).replace(".", ","), r.flow === 1 ? "Entrada" : "Saída",
        r.classification?.path ?? "", r.account?.code ?? "", r.paid_at ?? ""].join(";")
    );
    const blob = new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lancamentos-pagina-${page}.csv`;
    a.click();
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString("pt-BR")} lançamentos · fonte própria (ex-SenseBoard)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1 h-4 w-4" /> Exportar página
          </Button>
          <Button onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="mr-1 h-4 w-4" /> Novo lançamento
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-5">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs text-muted-foreground">Busca (descrição / nº doc)</label>
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Ex.: CMV, boleto…" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pagos">Pagos</SelectItem>
                <SelectItem value="pendentes">Pendentes</SelectItem>
                <SelectItem value="revisao">Em revisão</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Classificação</label>
            <Select value={clsFilter} onValueChange={(v) => { setClsFilter(v); setPage(1); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">Todas</SelectItem>
                {meta?.classifications.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.category} · {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Conta</label>
            <Select value={accFilter} onValueChange={(v) => { setAccFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {meta?.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Venc. de</label>
            <Input type="date" value={dueFrom} onChange={(e) => { setDueFrom(e.target.value); setPage(1); }} className="w-38" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Venc. até</label>
            <Input type="date" value={dueTo} onChange={(e) => { setDueTo(e.target.value); setPage(1); }} className="w-38" />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-300">
          <CardContent className="flex items-center gap-2 pt-5 text-red-700">
            <AlertTriangle className="h-4 w-4" /> Falha ao carregar: {error}
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parceiro / Descrição</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Classificação</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Nenhum lançamento com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.map((r) => (
              <TableRow key={r.id} className={r.needs_review ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
                <TableCell className="max-w-[260px]">
                  <div className="truncate font-medium">{r.partner?.name ?? "—"}</div>
                  {r.description && <div className="truncate text-xs text-muted-foreground">{r.description}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateBR(r.due_date)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateBR(r.competence_date)}</TableCell>
                <TableCell className={`text-right tabular-nums font-medium ${r.flow === 1 ? "text-emerald-700" : "text-red-600"}`}>
                  {formatCurrency(r.amount)}
                </TableCell>
                <TableCell>
                  {r.kind === "transfer" ? (
                    <Badge variant="outline" className="border-amber-400 text-amber-700">Transferência</Badge>
                  ) : r.kind === "depreciation" ? (
                    <Badge variant="outline">Depreciação</Badge>
                  ) : r.kind === "accrual" ? (
                    <Badge variant="outline">Provisão</Badge>
                  ) : r.flow === 1 ? (
                    <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Entrada</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-900 hover:bg-red-100">Saída</Badge>
                  )}
                  {r.needs_review && <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700">revisar</Badge>}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <div className="truncate" title={r.classification?.path}>{r.classification?.name ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.classification?.category}</div>
                </TableCell>
                <TableCell>{r.account?.code ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={!!r.paid_at} onCheckedChange={() => void togglePaid(r)} />
                    {r.paid_at && <span className="text-xs text-muted-foreground">{fmtDateBR(r.paid_at)}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => void remove(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Página {page} de {totalPages.toLocaleString("pt-BR")}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Parceiro *</label>
                <Input value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} placeholder="Nome do parceiro" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Valor (R$) *</label>
                <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Classificação *</label>
                <Select value={form.classification_id} onValueChange={(v) => setForm({ ...form, classification_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione a classificação" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {meta?.classifications.filter((c) => c.is_active).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.category} · {c.name} {c.flow === 1 ? "(entrada)" : "(saída)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vencimento</label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Competência</label>
                <Input type="date" value={form.competence_date} onChange={(e) => setForm({ ...form, competence_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Conta bancária</label>
                <Select value={form.bank_account_id || "none"} onValueChange={(v) => setForm({ ...form, bank_account_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem conta</SelectItem>
                    {meta?.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.bank_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nº do documento</label>
                <Input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Descrição</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: v })} />
                <span className="text-sm">Pago</span>
              </div>
              {form.paid && (
                <div>
                  <label className="text-xs text-muted-foreground">Data de pagamento</label>
                  <Input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={saving || !form?.classification_id || !form?.amount}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
