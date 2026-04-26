"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Coins,
  RefreshCcw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Send,
  Users,
  Settings2,
  TrendingUp,
  Wallet,
  Clock,
  Repeat,
} from "lucide-react";

// --- Types ---

interface Metrics {
  windowDays: number;
  counts: { pedidoCount: number; depositadoCount: number; usadoCount: number };
  totals: { emitido: number; depositado: number; usado: number; expirado: number; ativoNow: number };
  ratios: { conversionRate: number; breakageRate: number; avgUsedTicket: number };
}

interface Transaction {
  id: string;
  source_order_id: string;
  numero_pedido: string | null;
  email: string;
  nome_cliente: string | null;
  telefone: string | null;
  valor_pedido: number;
  valor_cashback: number;
  status: string;
  confirmado_em: string;
  depositado_em: string | null;
  expira_em: string;
  usado_em: string | null;
  estornado_em: string | null;
  reativado: boolean;
  lembrete1_enviado_em: string | null;
  lembrete2_enviado_em: string | null;
  lembrete3_enviado_em: string | null;
}

interface Config {
  percentage: number;
  calculate_over: "net" | "subtotal" | "total";
  deposit_delay_days: number;
  validity_days: number;
  reminder_1_day: number;
  reminder_2_day: number;
  reminder_3_day: number;
  reactivation_days: number;
  reactivation_reminder_day: number;
  whatsapp_min_value: number;
  email_min_value: number;
  channel_mode: "whatsapp_only" | "email_only" | "both" | "custom";
  enable_whatsapp: boolean;
  enable_email: boolean;
  enable_deposit: boolean;
  enable_refund: boolean;
  enable_troquecommerce: boolean;
  excluded_client_tags: string[];
}

interface Template {
  canal: "whatsapp" | "email";
  estagio: "LEMBRETE_1" | "LEMBRETE_2" | "LEMBRETE_3" | "REATIVACAO" | "REATIVACAO_LEMBRETE";
  enabled: boolean;
  wa_template_name: string | null;
  wa_template_language: string | null;
  email_subject: string | null;
  email_body_html: string | null;
}

interface VndaConnection {
  id: string;
  store_host: string;
  enable_cashback: boolean;
}

interface TroqueLog {
  id: string;
  external_id: string | null;
  ecommerce_number: string | null;
  reverse_type: string | null;
  status: string;
  cashback_id: string | null;
  amount_deducted: number | null;
  payload: unknown;
  error_message: string | null;
  created_at: string;
}

const TROQUE_STATUS_COLORS: Record<string, string> = {
  processed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  no_cashback: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  duplicate: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  ignored_status: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  skipped: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
};

// --- Helpers ---

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PCT = (v: number) => `${(v * 100).toFixed(1)}%`;

const STATUS_COLORS: Record<string, string> = {
  AGUARDANDO_DEPOSITO: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  ATIVO: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  REATIVADO: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  USADO: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  EXPIRADO: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  CANCELADO: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STAGE_LABEL: Record<string, string> = {
  LEMBRETE_1: "Lembrete 1 (depósito)",
  LEMBRETE_2: "Lembrete 2 (meio)",
  LEMBRETE_3: "Lembrete 3 (véspera)",
  REATIVACAO: "Reativação",
  REATIVACAO_LEMBRETE: "Lembrete pós-reativação",
};

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR");
}

// --- Dashboard Tab ---

function DashboardTab({ workspaceId }: { workspaceId: string }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const res = await fetch(`/api/cashback/metrics?days=${windowDays}`, {
      headers: { "x-workspace-id": workspaceId },
    });
    if (res.ok) setMetrics(await res.json());
    setLoading(false);
  }, [workspaceId, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando métricas…
      </div>
    );
  }

  const kpis: Array<{ icon: React.ReactNode; label: string; value: string; hint?: string }> = [
    {
      icon: <Coins className="h-4 w-4 text-amber-400" />,
      label: "Emitido",
      value: BRL(metrics.totals.emitido),
      hint: `${metrics.counts.pedidoCount} pedidos`,
    },
    {
      icon: <Wallet className="h-4 w-4 text-emerald-400" />,
      label: "Depositado",
      value: BRL(metrics.totals.depositado),
      hint: `${metrics.counts.depositadoCount} depósitos`,
    },
    {
      icon: <TrendingUp className="h-4 w-4 text-fuchsia-400" />,
      label: "Usado (convertido)",
      value: BRL(metrics.totals.usado),
      hint: `${metrics.counts.usadoCount} usos`,
    },
    {
      icon: <Clock className="h-4 w-4 text-zinc-400" />,
      label: "Expirado",
      value: BRL(metrics.totals.expirado),
      hint: `breakage ${PCT(metrics.ratios.breakageRate)}`,
    },
    {
      icon: <Repeat className="h-4 w-4 text-cyan-400" />,
      label: "Saldo ativo agora",
      value: BRL(metrics.totals.ativoNow),
    },
    {
      icon: <CheckCircle2 className="h-4 w-4 text-violet-400" />,
      label: "Conversão",
      value: PCT(metrics.ratios.conversionRate),
      hint: `ticket médio ${BRL(metrics.ratios.avgUsedTicket)}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Janela:</Label>
          <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="365">1 ano</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {k.icon} {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{k.value}</div>
              {k.hint && <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Clientes Tab ---

function ClientesTab({ workspaceId }: { workspaceId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [emailFilter, setEmailFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const pageSize = 25;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status !== "all") params.set("status", status);
    if (emailFilter) params.set("email", emailFilter);
    const res = await fetch(`/api/cashback/transactions?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    });
    if (res.ok) {
      const j = await res.json();
      setTransactions(j.transactions);
      setTotal(j.pagination.total);
    }
    setLoading(false);
  }, [workspaceId, page, status, emailFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const reactivate = useCallback(
    async (id: string) => {
      if (!confirm("Reativar este cashback? Isso vai depositar o crédito de volta na VNDA.")) return;
      const res = await fetch(`/api/cashback/transactions/${id}/reactivate`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      if (res.ok) {
        alert("Cashback reativado com sucesso.");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Falhou: ${err.error || res.status}`);
      }
    },
    [workspaceId, load]
  );

  const forceReminder = useCallback(
    async (id: string, stage: string) => {
      const res = await fetch(`/api/cashback/transactions/${id}/force-reminder`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
        body: JSON.stringify({ stage, reset: true }),
      });
      if (res.ok) {
        alert("Lembrete disparado.");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Falhou: ${err.error || res.status}`);
      }
    },
    [workspaceId, load]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filtrar por e-mail…"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(1);
              load();
            }
          }}
          className="w-64"
        />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="AGUARDANDO_DEPOSITO">Aguardando depósito</SelectItem>
            <SelectItem value="ATIVO">Ativo</SelectItem>
            <SelectItem value="REATIVADO">Reativado</SelectItem>
            <SelectItem value="USADO">Usado</SelectItem>
            <SelectItem value="EXPIRADO">Expirado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Atualizar
        </Button>
        <div className="ml-auto">
          <Button variant="secondary" size="sm" onClick={() => setBatchOpen(true)}>
            <Repeat className="mr-2 h-3.5 w-3.5" /> Reativar em massa
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum cashback encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Pedido</th>
                    <th className="px-3 py-2 text-left font-medium">Cliente</th>
                    <th className="px-3 py-2 text-left font-medium">Valor</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Confirmado</th>
                    <th className="px-3 py-2 text-left font-medium">Expira</th>
                    <th className="px-3 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{t.numero_pedido || t.source_order_id}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{t.nome_cliente || "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.email}</div>
                      </td>
                      <td className="px-3 py-2 font-semibold">{BRL(Number(t.valor_cashback))}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={STATUS_COLORS[t.status] || ""}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDate(t.confirmado_em)}</td>
                      <td className="px-3 py-2 text-xs">{formatDate(t.expira_em)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(t)}>
                          Detalhes
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Total: <strong>{total}</strong>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="flex items-center px-3 text-sm">Página {page} de {Math.max(1, Math.ceil(total / pageSize))}</span>
          <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pedido #{detail?.numero_pedido || detail?.source_order_id}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Cliente</div>
                  <div className="font-medium">{detail.nome_cliente || "—"}</div>
                  <div className="text-xs text-muted-foreground">{detail.email}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Telefone</div>
                  <div className="font-mono text-xs">{detail.telefone || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Valor do pedido</div>
                  <div className="font-semibold">{BRL(Number(detail.valor_pedido))}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Cashback</div>
                  <div className="font-semibold text-amber-400">{BRL(Number(detail.valor_cashback))}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Depositado em</div>
                  <div>{formatDate(detail.depositado_em)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Expira em</div>
                  <div>{formatDate(detail.expira_em)}</div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">Régua de lembretes</div>
                <div className="text-xs">
                  L1: {formatDate(detail.lembrete1_enviado_em)} · L2: {formatDate(detail.lembrete2_enviado_em)} · L3: {formatDate(detail.lembrete3_enviado_em)}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {detail.status === "EXPIRADO" && !detail.reativado && (
                  <Button size="sm" onClick={() => reactivate(detail.id)}>
                    <Repeat className="mr-2 h-3.5 w-3.5" /> Reativar +{/* reactivation_days */}
                  </Button>
                )}
                {(detail.status === "ATIVO" || detail.status === "REATIVADO") && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => forceReminder(detail.id, "LEMBRETE_1")}>
                      <Send className="mr-2 h-3 w-3" /> Lembrete 1
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => forceReminder(detail.id, "LEMBRETE_2")}>
                      <Send className="mr-2 h-3 w-3" /> Lembrete 2
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => forceReminder(detail.id, "LEMBRETE_3")}>
                      <Send className="mr-2 h-3 w-3" /> Lembrete 3
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BatchReactivateDialog
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        workspaceId={workspaceId}
        onDone={load}
      />
    </div>
  );
}

function BatchReactivateDialog({
  open,
  onClose,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onDone: () => void;
}) {
  const [expiredSinceDays, setExpiredSinceDays] = useState(30);
  const [minValue, setMinValue] = useState(10);
  const [limit, setLimit] = useState(50);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ count?: number; success?: number; failed?: number } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/cashback/reactivate-batch", {
      method: "POST",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { expiredSinceDays, minValue },
        limit,
        dryRun,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setResult(j);
    setBusy(false);
    if (!dryRun && res.ok) onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reativar em massa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Expirado nos últimos (dias)</Label>
            <Input type="number" value={expiredSinceDays} onChange={(e) => setExpiredSinceDays(Number(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label>Valor mínimo do cashback (R$)</Label>
            <Input type="number" value={minValue} onChange={(e) => setMinValue(Number(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label>Limite de reativações por execução</Label>
            <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={dryRun} onCheckedChange={setDryRun} />
            <Label>Dry-run (só conta, não executa)</Label>
          </div>

          {result && (
            <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm">
              {dryRun ? (
                <>Encontrados <strong>{result.count ?? 0}</strong> cashbacks elegíveis.</>
              ) : (
                <>Reativados: <strong>{result.success ?? 0}</strong> · Falharam: <strong>{result.failed ?? 0}</strong></>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            <Button onClick={run} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dryRun ? "Contar elegíveis" : "Reativar agora"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Config Tab ---

function TroqueLogsCard({ workspaceId }: { workspaceId: string }) {
  const [logs, setLogs] = useState<TroqueLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/cashback/troque-logs?limit=50`, {
      headers: { "x-workspace-id": workspaceId },
    });
    if (res.ok) {
      const j = await res.json();
      setLogs(j.logs);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [auto, load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          Logs do webhook Troquecommerce
          {auto && <span className="ml-2 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" title="polling a cada 15s" />}
        </CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={auto} onCheckedChange={setAuto} />
            <Label className="text-xs text-muted-foreground">Auto-refresh (15s)</Label>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCcw className="mr-2 h-3 w-3" /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum webhook recebido ainda. Cole a URL acima no painel do Troquecommerce e aguarde a primeira troca/devolução.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Quando</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Pedido VNDA</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-right font-medium">Abate</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <React.Fragment key={l.id}>
                    <tr className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(l.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={TROQUE_STATUS_COLORS[l.status] || ""}>
                          {l.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.ecommerce_number || "—"}</td>
                      <td className="px-3 py-2 text-xs">{l.reverse_type || "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {l.amount_deducted ? BRL(Number(l.amount_deducted)) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                          {expanded === l.id ? "ocultar" : "ver payload"}
                        </Button>
                      </td>
                    </tr>
                    {expanded === l.id && (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          {l.error_message && (
                            <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
                              <strong>Erro:</strong> {l.error_message}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mb-1">
                            external_id: <span className="font-mono">{l.external_id || "—"}</span>
                            {l.cashback_id && <> · cashback_id: <span className="font-mono">{l.cashback_id.slice(0, 8)}…</span></>}
                          </div>
                          <pre className="max-h-64 overflow-auto rounded-md bg-black/30 p-3 text-xs font-mono">
                            {JSON.stringify(l.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigTab({ workspaceId }: { workspaceId: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [vndaConnections, setVndaConnections] = useState<VndaConnection[]>([]);
  const [saving, setSaving] = useState(false);
  const [smtp, setSmtp] = useState<{ provider?: string; from_email?: string; from_name?: string; reply_to?: string } | null>(null);
  const [smtpToken, setSmtpToken] = useState("");
  const [smtpForm, setSmtpForm] = useState({ from_email: "", from_name: "", reply_to: "" });
  const [troqueToken, setTroqueToken] = useState("");
  const [troqueWebhookUrl, setTroqueWebhookUrl] = useState<string | null>(null);
  const [troqueActivity, setTroqueActivity] = useState<{ total: number; processed: number; no_cashback: number; duplicate: number; error: number } | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [c, t, i] = await Promise.all([
      fetch("/api/cashback/config", { headers: { "x-workspace-id": workspaceId } }).then((r) => r.json()),
      fetch("/api/cashback/templates", { headers: { "x-workspace-id": workspaceId } }).then((r) => r.json()),
      fetch("/api/cashback/integrations", { headers: { "x-workspace-id": workspaceId } }).then((r) => r.json()),
    ]);
    setCfg(c.config);
    setTemplates(t.templates);
    setVndaConnections(i.vnda);
    setSmtp(i.smtp);
    setSmtpForm({
      from_email: i.smtp?.from_email || "",
      from_name: i.smtp?.from_name || "",
      reply_to: i.smtp?.reply_to || "",
    });
    setTroqueWebhookUrl(i.troque?.webhook_url || null);
    setTroqueActivity(i.troque_webhook_activity_7d || null);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    if (!cfg) return;
    setSaving(true);
    await fetch("/api/cashback/config", {
      method: "PUT",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setSaving(false);
  }

  async function saveTemplates() {
    setSaving(true);
    await fetch("/api/cashback/templates", {
      method: "PUT",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify({ templates }),
    });
    setSaving(false);
  }

  async function toggleVnda(id: string, on: boolean) {
    await fetch("/api/cashback/integrations", {
      method: "PATCH",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify({ vndaConnectionId: id, enableCashback: on }),
    });
    load();
  }

  async function saveSmtp() {
    if (!smtpToken || !smtpForm.from_email) {
      alert("Token e e-mail de origem são obrigatórios.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/cashback/smtp-config", {
      method: "PUT",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "locaweb",
        apiToken: smtpToken,
        fromEmail: smtpForm.from_email,
        fromName: smtpForm.from_name,
        replyTo: smtpForm.reply_to,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSmtpToken("");
      alert("SMTP salvo.");
      load();
    } else {
      alert("Falha ao salvar SMTP.");
    }
  }

  async function saveTroque() {
    if (!troqueToken) {
      alert("Token Troquecommerce obrigatório.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/cashback/troque-config", {
      method: "PUT",
      headers: { "x-workspace-id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: troqueToken }),
    });
    setSaving(false);
    if (res.ok) {
      setTroqueToken("");
      alert("Troquecommerce salvo.");
    } else {
      alert("Falha ao salvar Troquecommerce.");
    }
  }

  const templateByKey = useMemo(() => {
    const map = new Map<string, Template>();
    templates.forEach((t) => map.set(`${t.canal}|${t.estagio}`, t));
    return map;
  }, [templates]);

  function upsertTemplate(canal: "whatsapp" | "email", estagio: Template["estagio"], patch: Partial<Template>) {
    const key = `${canal}|${estagio}`;
    const existing = templateByKey.get(key) || {
      canal,
      estagio,
      enabled: true,
      wa_template_name: null,
      wa_template_language: "pt_BR",
      email_subject: null,
      email_body_html: null,
    };
    const merged = { ...existing, ...patch };
    const others = templates.filter((t) => `${t.canal}|${t.estagio}` !== key);
    setTemplates([...others, merged]);
  }

  if (!cfg) return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando configuração…</div>;

  const STAGES: Template["estagio"][] = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];

  return (
    <Tabs defaultValue="regras" className="space-y-4">
      <TabsList>
        <TabsTrigger value="regras">Regras</TabsTrigger>
        <TabsTrigger value="regua">Régua &amp; Templates</TabsTrigger>
        <TabsTrigger value="integracoes">Integrações</TabsTrigger>
      </TabsList>

      <TabsContent value="regras" className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Cálculo do cashback</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1">
              <Label>Percentual (%)</Label>
              <Input type="number" step="0.1" value={cfg.percentage} onChange={(e) => setCfg({ ...cfg, percentage: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1">
              <Label>Calcular sobre</Label>
              <Select value={cfg.calculate_over} onValueChange={(v: Config["calculate_over"]) => setCfg({ ...cfg, calculate_over: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="net">Líquido (total − frete)</SelectItem>
                  <SelectItem value="subtotal">Subtotal</SelectItem>
                  <SelectItem value="total">Total bruto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ciclo de vida</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1">
              <Label>Dias até depósito</Label>
              <Input type="number" value={cfg.deposit_delay_days} onChange={(e) => setCfg({ ...cfg, deposit_delay_days: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1">
              <Label>Validade após depósito (dias)</Label>
              <Input type="number" value={cfg.validity_days} onChange={(e) => setCfg({ ...cfg, validity_days: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1">
              <Label>Validade da reativação (dias)</Label>
              <Input type="number" value={cfg.reactivation_days} onChange={(e) => setCfg({ ...cfg, reactivation_days: Number(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Gates de envio</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>Valor mínimo para WhatsApp (R$)</Label>
              <Input type="number" step="0.01" value={cfg.whatsapp_min_value} onChange={(e) => setCfg({ ...cfg, whatsapp_min_value: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1">
              <Label>Valor mínimo para e-mail (R$)</Label>
              <Input type="number" step="0.01" value={cfg.email_min_value} onChange={(e) => setCfg({ ...cfg, email_min_value: Number(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Elegibilidade do cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>Tags VNDA que NÃO recebem cashback (separadas por vírgula)</Label>
            <Input
              value={(cfg.excluded_client_tags || []).join(", ")}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  excluded_client_tags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="bulking-club"
            />
            <p className="text-xs text-muted-foreground">
              Clientes com qualquer dessas tags na VNDA são <strong>excluídos</strong> da régua de cashback (já recebem outros benefícios). Padrão: <code>bulking-club</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Feature flags</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              ["enable_deposit", "Depositar crédito na VNDA"],
              ["enable_refund", "Estornar crédito expirado"],
              ["enable_whatsapp", "Enviar WhatsApp"],
              ["enable_email", "Enviar e-mail"],
              ["enable_troquecommerce", "Abater trocas (Troquecommerce)"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label>{label}</Label>
                <Switch checked={Boolean(cfg[key as keyof Config])} onCheckedChange={(v) => setCfg({ ...cfg, [key]: v } as Config)} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={saveConfig} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar regras
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="regua" className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Canal de comunicação</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1 md:max-w-sm">
              <Label>Modo</Label>
              <Select value={cfg.channel_mode} onValueChange={(v: Config["channel_mode"]) => setCfg({ ...cfg, channel_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Ambos (WhatsApp + e-mail)</SelectItem>
                  <SelectItem value="whatsapp_only">Só WhatsApp</SelectItem>
                  <SelectItem value="email_only">Só e-mail</SelectItem>
                  <SelectItem value="custom">Personalizado por estágio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              No modo <strong>Personalizado</strong>, cada linha da régua abaixo tem um switch individual por canal.
              Nos outros modos, a seleção aqui sobrepõe as linhas.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Timing dos lembretes</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-1"><Label>Lembrete 1 (dia)</Label><Input type="number" value={cfg.reminder_1_day} onChange={(e) => setCfg({ ...cfg, reminder_1_day: Number(e.target.value) })} /></div>
            <div className="grid gap-1"><Label>Lembrete 2 (dia)</Label><Input type="number" value={cfg.reminder_2_day} onChange={(e) => setCfg({ ...cfg, reminder_2_day: Number(e.target.value) })} /></div>
            <div className="grid gap-1"><Label>Lembrete 3 (dia)</Label><Input type="number" value={cfg.reminder_3_day} onChange={(e) => setCfg({ ...cfg, reminder_3_day: Number(e.target.value) })} /></div>
            <div className="grid gap-1"><Label>Pós-reativação (dia)</Label><Input type="number" value={cfg.reactivation_reminder_day} onChange={(e) => setCfg({ ...cfg, reactivation_reminder_day: Number(e.target.value) })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Templates por estágio</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {STAGES.map((estagio) => {
              const wa = templateByKey.get(`whatsapp|${estagio}`);
              const em = templateByKey.get(`email|${estagio}`);
              const isCustom = cfg.channel_mode === "custom";
              return (
                <div key={estagio} className="rounded-md border p-4">
                  <div className="mb-3 font-medium">{STAGE_LABEL[estagio]}</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">WhatsApp</Label>
                        {isCustom && (
                          <Switch checked={wa?.enabled ?? true} onCheckedChange={(v) => upsertTemplate("whatsapp", estagio, { enabled: v })} />
                        )}
                      </div>
                      <Input
                        placeholder="Nome do template (wa_templates)"
                        value={wa?.wa_template_name || ""}
                        onChange={(e) => upsertTemplate("whatsapp", estagio, { wa_template_name: e.target.value })}
                      />
                      <Input
                        placeholder="Idioma (pt_BR)"
                        value={wa?.wa_template_language || "pt_BR"}
                        onChange={(e) => upsertTemplate("whatsapp", estagio, { wa_template_language: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">E-mail</Label>
                        {isCustom && (
                          <Switch checked={em?.enabled ?? true} onCheckedChange={(v) => upsertTemplate("email", estagio, { enabled: v })} />
                        )}
                      </div>
                      <Input
                        placeholder="Assunto (usa {{nome}}, {{valor}}, {{expira_em}}, {{pedido}})"
                        value={em?.email_subject || ""}
                        onChange={(e) => upsertTemplate("email", estagio, { email_subject: e.target.value })}
                      />
                      <Textarea
                        placeholder="<html>...</html>"
                        className="min-h-28 font-mono text-xs"
                        value={em?.email_body_html || ""}
                        onChange={(e) => upsertTemplate("email", estagio, { email_body_html: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={saveConfig} disabled={saving}>Salvar timing/modo</Button>
          <Button onClick={saveTemplates} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar templates
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="integracoes" className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Conexões VNDA</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {vndaConnections.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma conexão VNDA configurada neste workspace.</p>
            )}
            {vndaConnections.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="font-mono text-sm">{c.store_host}</div>
                  <div className="text-xs text-muted-foreground">
                    Cashback {c.enable_cashback ? <Badge className="bg-emerald-500/20 text-emerald-400">ativo</Badge> : <Badge variant="outline">desligado</Badge>}
                  </div>
                </div>
                <Switch checked={c.enable_cashback} onCheckedChange={(v) => toggleVnda(c.id, v)} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>E-mail (Locaweb SMTP)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {smtp?.from_email && (
              <p className="text-xs text-muted-foreground">
                Configurado para <strong>{smtp.from_email}</strong>. Reenvie o token se quiser trocar.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1"><Label>Token da API Locaweb</Label><Input type="password" value={smtpToken} onChange={(e) => setSmtpToken(e.target.value)} placeholder="x-auth-token" /></div>
              <div className="grid gap-1"><Label>E-mail de origem</Label><Input value={smtpForm.from_email} onChange={(e) => setSmtpForm({ ...smtpForm, from_email: e.target.value })} placeholder="no-reply@bulkingclub.com.br" /></div>
              <div className="grid gap-1"><Label>Nome de origem</Label><Input value={smtpForm.from_name} onChange={(e) => setSmtpForm({ ...smtpForm, from_name: e.target.value })} placeholder="Bulking" /></div>
              <div className="grid gap-1"><Label>Reply-to</Label><Input value={smtpForm.reply_to} onChange={(e) => setSmtpForm({ ...smtpForm, reply_to: e.target.value })} placeholder="atendimento@bulkingclub.com.br" /></div>
            </div>
            <div className="flex justify-end"><Button onClick={saveSmtp} disabled={saving}>Salvar SMTP</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Troquecommerce</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1 md:max-w-sm">
              <Label>Token da API (polling fallback — opcional)</Label>
              <Input type="password" value={troqueToken} onChange={(e) => setTroqueToken(e.target.value)} placeholder="Bearer token" />
            </div>
            <div className="flex justify-end"><Button onClick={saveTroque} disabled={saving}>Salvar token</Button></div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <Label className="text-sm font-semibold text-amber-400">URL do webhook (cole no painel do Troquecommerce)</Label>
              {troqueWebhookUrl ? (
                <div className="flex gap-2">
                  <Input readOnly value={troqueWebhookUrl} className="font-mono text-xs" />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(troqueWebhookUrl);
                    }}
                  >
                    Copiar
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Salve o token acima primeiro — a URL é gerada junto.</p>
              )}
              <p className="text-xs text-muted-foreground">
                Troquecommerce envia o webhook sempre que uma troca/devolução muda de status. Quando a status indica troca ativa (aprovada, em trânsito, entregue, finalizada), o sistema abate <strong>{cfg.percentage}%</strong> do valor do item do cashback correspondente. Idempotente por `external_id` — reenvios não duplicam.
              </p>
              {troqueActivity && (
                <p className="text-xs text-muted-foreground">
                  Últimos 7 dias: <strong>{troqueActivity.total}</strong> webhooks · {troqueActivity.processed} processados · {troqueActivity.no_cashback} sem cashback · {troqueActivity.duplicate} duplicados · {troqueActivity.error} erros
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <TroqueLogsCard workspaceId={workspaceId} />
      </TabsContent>
    </Tabs>
  );
}

// --- Page ---

export default function CashbackPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id || "";

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <AlertTriangle className="mr-2 h-4 w-4" /> Nenhum workspace selecionado.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Coins className="h-6 w-6 text-amber-400" /> Cashback
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie a régua de cashback da Bulking — regras, lembretes e saldo por cliente.
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard"><TrendingUp className="mr-2 h-3.5 w-3.5" /> Dashboard</TabsTrigger>
          <TabsTrigger value="clientes"><Users className="mr-2 h-3.5 w-3.5" /> Clientes</TabsTrigger>
          <TabsTrigger value="config"><Settings2 className="mr-2 h-3.5 w-3.5" /> Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab workspaceId={workspaceId} /></TabsContent>
        <TabsContent value="clientes"><ClientesTab workspaceId={workspaceId} /></TabsContent>
        <TabsContent value="config"><ConfigTab workspaceId={workspaceId} /></TabsContent>
      </Tabs>
    </div>
  );
}
