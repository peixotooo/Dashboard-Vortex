"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Plus, Pencil, Trash2, Copy, Check, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
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
import { PartnerInput } from "../partner-input";
import { SearchSelect, type Option } from "../search-select";

/** Label legível de uma classificação a partir do caminho completo. */
function clsLabel(c: { path: string; name: string; category: string }): string {
  const leaf = c.path.startsWith(c.category + " - ") ? c.path.slice(c.category.length + 3) : c.name;
  return `${c.category} · ${leaf}`;
}

/** Input de data que abre o calendário ao clicar em qualquer lugar do campo. */
function DateField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* navegador sem suporte */ } }}
      className={`cursor-pointer ${className ?? ""}`}
    />
  );
}

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
  repeat: boolean;
  repeat_count: string;
  repeat_keep_competence: boolean;
};

const EMPTY_FORM: FormState = {
  doc_number: "", description: "", partner_name: "", classification_id: "",
  bank_account_id: "", competence_date: "", due_date: "", paid: false, paid_at: "",
  amount: "", observation: "", repeat: false, repeat_count: "12", repeat_keep_competence: false,
};

export default function LancamentosPage() {
  const { workspace } = useWorkspace();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totals, setTotals] = React.useState<{ entradas: number; saidas: number; saldo: number; count: number } | null>(null);
  const [totalsLoading, setTotalsLoading] = React.useState(true);
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
  const [paidFrom, setPaidFrom] = React.useState("");
  const [paidTo, setPaidTo] = React.useState("");
  const [quick, setQuick] = React.useState("");

  // options de dropdown com busca
  const clsOptions: Option[] = React.useMemo(
    () => (meta?.classifications ?? []).map((c) => ({ value: c.id, label: clsLabel(c) })),
    [meta]
  );
  // no form, todas as classificações (não só ativas) com o fluxo indicado —
  // ativas primeiro; corrige o caso do Raphael (folha/receita não apareciam)
  const clsFormOptions: Option[] = React.useMemo(() => {
    const list = (meta?.classifications ?? []).slice().sort((a, b) =>
      (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1) || clsLabel(a).localeCompare(clsLabel(b), "pt-BR")
    );
    return list.map((c) => ({ value: c.id, label: `${clsLabel(c)} ${c.flow === 1 ? "(entrada)" : "(saída)"}` }));
  }, [meta]);
  const accOptions: Option[] = React.useMemo(
    () => (meta?.accounts ?? []).map((a) => ({ value: a.id, label: a.bank_name ? `${a.code} — ${a.bank_name}` : a.code })),
    [meta]
  );

  // seleção múltipla
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);

  // form
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);

  const headers = React.useMemo(
    () => ({ "x-workspace-id": workspace?.id ?? "", "Content-Type": "application/json" }),
    [workspace?.id]
  );

  const filterParams = React.useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "todos") params.set("status", status);
    if (clsFilter !== "all") params.set("classification_id", clsFilter);
    if (accFilter !== "all") params.set("account_id", accFilter);
    if (dueFrom) params.set("due_from", dueFrom);
    if (dueTo) params.set("due_to", dueTo);
    if (paidFrom) params.set("paid_from", paidFrom);
    if (paidTo) params.set("paid_to", paidTo);
    if (quick) params.set("quick", quick);
    return params;
  }, [q, status, clsFilter, accFilter, dueFrom, dueTo, paidFrom, paidTo, quick]);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = filterParams();
      params.set("page", String(page));
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
  }, [workspace?.id, page, filterParams]);

  React.useEffect(() => { void load(); }, [load]);

  // Totais do conjunto filtrado — request separado (a tabela não espera a soma)
  // e independente da página. `reloadTick` força re-busca após mutações.
  const [reloadTick, setReloadTick] = React.useState(0);
  React.useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    setTotalsLoading(true);
    fetch(`/api/controladoria/lancamentos/totals?${filterParams()}`, {
      headers: { "x-workspace-id": workspace.id },
      cache: "no-store",
    })
      .then(async (r) => (r.ok ? (await r.json()).totals : null))
      .then((t) => { if (!cancelled) setTotals(t ?? null); })
      .catch(() => { if (!cancelled) setTotals(null); })
      .finally(() => { if (!cancelled) setTotalsLoading(false); });
    return () => { cancelled = true; };
  }, [workspace?.id, filterParams, reloadTick]);

  const hasActiveFilters =
    !!q || status !== "todos" || clsFilter !== "all" || accFilter !== "all" ||
    !!dueFrom || !!dueTo || !!paidFrom || !!paidTo || !!quick;

  const clearFilters = () => {
    setQ(""); setStatus("todos"); setClsFilter("all"); setAccFilter("all");
    setDueFrom(""); setDueTo(""); setPaidFrom(""); setPaidTo(""); setQuick("");
    setPage(1);
  };

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
    const isSeries = /^\(\d+\/\d+\)/.test(row.description ?? "");
    let url = `/api/controladoria/lancamentos/${row.id}`;
    if (isSeries) {
      const all = confirm(`Este lançamento é uma parcela (${(row.description ?? "").match(/^\(\d+\/\d+\)/)?.[0]}).\n\nOK = excluir a SÉRIE inteira · Cancelar = só este.`);
      if (all) url += "?series=1";
    } else {
      if (!confirm(`Excluir o lançamento de ${formatCurrency(row.amount)} (${row.classification?.name ?? "?"})? Vai para a lixeira.`)) return;
    }
    await fetch(url, { method: "DELETE", headers });
    void load(); setReloadTick((t) => t + 1);
  };

  const duplicate = (row: Row) => {
    setForm({
      doc_number: row.doc_number ?? "",
      description: row.description?.replace(/^\(\d+\/\d+\)\s*/, "") ?? "",
      partner_name: row.partner?.name ?? "",
      classification_id: row.classification?.id ?? "",
      bank_account_id: row.account?.id ?? "",
      competence_date: row.competence_date ?? "",
      due_date: row.due_date ?? "",
      paid: false, paid_at: "",
      amount: String(row.amount),
      observation: row.observation ?? "",
      repeat: false, repeat_count: "12", repeat_keep_competence: false,
    });
  };

  const runBulk = async (action: string, label: string) => {
    if (!workspace?.id || selected.size === 0) return;
    if (action === "delete" && !confirm(`${label} ${selected.size} lançamento(s)?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/controladoria/lancamentos/bulk", {
        method: "POST", headers, body: JSON.stringify({ ids: [...selected], action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSelected(new Set());
      void load(); setReloadTick((t) => t + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "erro");
    } finally {
      setBulkBusy(false);
    }
  };

  const toggleSel = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPage) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });

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
      repeat: false, repeat_count: "12", repeat_keep_competence: false,
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
        repeat_count: !form.id && form.repeat ? parseInt(form.repeat_count, 10) || 1 : 1,
        repeat_keep_competence: form.repeat_keep_competence,
      };
      const res = form.id
        ? await fetch(`/api/controladoria/lancamentos/${form.id}`, { method: "PATCH", headers, body: JSON.stringify(payload) })
        : await fetch(`/api/controladoria/lancamentos`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json().catch(() => ({}));
      if (j.count > 1) alert(`${j.count} lançamentos criados (repetição).`);
      setForm(null);
      void load(); setReloadTick((t) => t + 1);
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
          <div className="w-64">
            <label className="text-xs text-muted-foreground">Classificação</label>
            <SearchSelect
              value={clsFilter === "all" ? "" : clsFilter}
              onChange={(v) => { setClsFilter(v || "all"); setPage(1); }}
              options={clsOptions}
              placeholder="Todas"
              clearable
            />
          </div>
          <div className="w-40">
            <label className="text-xs text-muted-foreground">Conta</label>
            <SearchSelect
              value={accFilter === "all" ? "" : accFilter}
              onChange={(v) => { setAccFilter(v || "all"); setPage(1); }}
              options={accOptions}
              placeholder="Todas"
              clearable
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Venc. de</label>
            <DateField value={dueFrom} onChange={(v) => { setDueFrom(v); setPage(1); }} className="w-38" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Venc. até</label>
            <DateField value={dueTo} onChange={(v) => { setDueTo(v); setPage(1); }} className="w-38" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Pago de</label>
            <DateField value={paidFrom} onChange={(v) => { setPaidFrom(v); setPage(1); }} className="w-38" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Pago até</label>
            <DateField value={paidTo} onChange={(v) => { setPaidTo(v); setPage(1); }} className="w-38" />
          </div>
          {/* filtros rápidos do dia a dia */}
          <div className="flex w-full flex-wrap items-center gap-1.5 pt-1">
            {[
              { k: "", label: "Tudo" },
              { k: "atraso", label: "Em atraso" },
              { k: "hoje", label: "Vence hoje" },
              { k: "semana", label: "Vence em 7 dias" },
              { k: "receber", label: "A receber" },
              { k: "pagar", label: "A pagar" },
            ].map((f) => (
              <button
                key={f.k}
                onClick={() => { setQuick(f.k); setPage(1); }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  quick === f.k ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto flex items-center gap-1 rounded-full border border-input px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" /> Limpar filtros
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* barra de ações em lote */}
      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("pay", "Dar baixa em")}>
              <Check className="mr-1 h-3.5 w-3.5" /> Dar baixa
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("unpay", "Estornar")}>
              <X className="mr-1 h-3.5 w-3.5" /> Estornar baixa
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void runBulk("review_done", "Marcar revisado")}>
              Marcar revisado
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={bulkBusy} onClick={() => void runBulk("delete", "Excluir")}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center gap-2 pt-5 text-destructive">
            <AlertTriangle className="h-4 w-4" /> Falha ao carregar: {error}
          </CardContent>
        </Card>
      )}

      {/* Totais do filtro (entradas / saídas / saldo) — no topo da lista */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Entradas {totals && `(${totals.count.toLocaleString("pt-BR")} lanç.)`}</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-700">
            {totalsLoading ? <Loader2 className="my-1 h-4 w-4 animate-spin text-muted-foreground" /> : totals ? formatCurrency(totals.entradas) : "—"}
          </div>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Saídas</div>
          <div className="text-lg font-semibold tabular-nums text-red-600">
            {totalsLoading ? <Loader2 className="my-1 h-4 w-4 animate-spin text-muted-foreground" /> : totals ? formatCurrency(totals.saidas) : "—"}
          </div>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Saldo (entradas − saídas)</div>
          <div className={`text-lg font-semibold tabular-nums ${totals && totals.saldo < 0 ? "text-red-600" : "text-blue-600"}`}>
            {totalsLoading ? <Loader2 className="my-1 h-4 w-4 animate-spin text-muted-foreground" /> : totals ? formatCurrency(totals.saldo) : "—"}
          </div>
        </CardContent></Card>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Selecionar todos" />
              </TableHead>
              <TableHead>Parceiro / Descrição</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Classificação</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  Nenhum lançamento com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-primary/5" : r.needs_review ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
                <TableCell>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label="Selecionar" />
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{r.partner?.name ?? "—"}</span>
                    {r.doc_number?.startsWith("AUTO-") && (
                      <span
                        className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 text-[10px] font-medium uppercase text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                        title="Lançamento automático (receita diária VNDA/Mercado Livre). Valor re-verificado por 7 dias; excluir é respeitado."
                      >
                        auto
                      </span>
                    )}
                  </div>
                  {r.description && <div className="truncate text-xs text-muted-foreground">{r.description}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateBR(r.due_date)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateBR(r.competence_date)}</TableCell>
                <TableCell className={`text-right tabular-nums font-medium ${r.flow === 1 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(r.amount)}
                </TableCell>
                <TableCell>
                  {r.kind === "transfer" ? (
                    <Badge variant="outline" className="border-warning/60 text-warning">Transferência</Badge>
                  ) : r.kind === "depreciation" ? (
                    <Badge variant="outline">Depreciação</Badge>
                  ) : r.kind === "accrual" ? (
                    <Badge variant="outline">Provisão</Badge>
                  ) : r.flow === 1 ? (
                    <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-950">Entrada</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-900 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-950">Saída</Badge>
                  )}
                  {r.needs_review && <Badge variant="outline" className="ml-1 border-warning/60 text-warning">revisar</Badge>}
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
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar" onClick={() => duplicate(r)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Excluir" onClick={() => void remove(r)}>
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
                <PartnerInput value={form.partner_name} onChange={(v) => setForm({ ...form, partner_name: v })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Valor (R$) *</label>
                <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Classificação *</label>
                <SearchSelect
                  value={form.classification_id}
                  onChange={(v) => setForm({ ...form, classification_id: v })}
                  options={clsFormOptions}
                  placeholder="Digite para buscar a classificação"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vencimento</label>
                <DateField value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Competência</label>
                <DateField value={form.competence_date} onChange={(v) => setForm({ ...form, competence_date: v })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Conta bancária</label>
                <SearchSelect
                  value={form.bank_account_id}
                  onChange={(v) => setForm({ ...form, bank_account_id: v })}
                  options={accOptions}
                  placeholder="Sem conta"
                  clearable
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nº do documento</label>
                <Input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Descrição</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Observação</label>
                <textarea
                  className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.observation}
                  onChange={(e) => setForm({ ...form, observation: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: v })} />
                <span className="text-sm">Pago</span>
              </div>
              {form.paid && (
                <div>
                  <label className="text-xs text-muted-foreground">Data de pagamento</label>
                  <DateField value={form.paid_at} onChange={(v) => setForm({ ...form, paid_at: v })} />
                </div>
              )}

              {!form.id && (
                <div className="sm:col-span-2 rounded-md border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.repeat} onCheckedChange={(v) => setForm({ ...form, repeat: v })} />
                    <span className="text-sm font-medium">Gerar repetições (parcelas, recorrência)?</span>
                  </div>
                  {form.repeat && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Número de repetições (meses)</label>
                        <Input
                          type="number" min={1} max={120}
                          value={form.repeat_count}
                          onChange={(e) => setForm({ ...form, repeat_count: e.target.value })}
                        />
                      </div>
                      <label className="flex items-end gap-2 pb-2 text-sm cursor-pointer">
                        <Switch checked={form.repeat_keep_competence} onCheckedChange={(v) => setForm({ ...form, repeat_keep_competence: v })} />
                        Manter data de competência inicial
                      </label>
                      <p className="sm:col-span-2 text-xs text-muted-foreground">
                        Serão criados {form.repeat_count || 1} lançamentos mensais a partir das datas acima
                        (vencimento avança 1 mês por parcela{form.repeat_keep_competence ? "; competência fixa na inicial" : "; competência também avança"}).
                      </p>
                    </div>
                  )}
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
