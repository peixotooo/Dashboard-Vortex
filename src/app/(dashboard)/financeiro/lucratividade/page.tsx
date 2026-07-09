"use client";

import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Calculator,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";

type OrderRow = {
  order_id: string | null;
  numero_pedido: string | null;
  customer_email: string | null;
  data_compra: string | null;
  valor: number;
  items_revenue: number;
  items_cost: number;
  taxes: number;
  other_expenses: number;
  shipping_absorbed: number;
  discount_total: number;
  profit: number;
  margin_pct: number;
  status: "profit" | "loss" | "breakeven";
};

type Summary = {
  total_revenue: number;
  total_profit: number;
  gross_margin_pct: number;
  profitable_orders: number;
  loss_orders: number;
  breakeven_orders: number;
  period_start: string | null;
  period_end: string | null;
};

type OrdersResponse = {
  summary: Summary | null;
  orders?: OrderRow[];
  orders_total?: number;
  orders_offset?: number;
  orders_limit?: number;
  period_days?: number;
  row_count?: number;
  computedAt: string | null;
  message?: string;
};

const PERIOD_OPTIONS = [7, 14, 30, 60, 90] as const;
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
type StatusFilter = "all" | "profit" | "loss" | "breakeven";

function formatPct(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LucratividadePage() {
  const { workspace } = useWorkspace();
  const [data, setData] = React.useState<OrdersResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [orderFilter, setOrderFilter] = React.useState<StatusFilter>("all");
  const [periodDays, setPeriodDays] = React.useState<number>(30);
  const [pageSize, setPageSize] = React.useState<number>(100);
  const [offset, setOffset] = React.useState<number>(0);

  const load = React.useCallback(
    async (off: number, size: number, status: StatusFilter) => {
      if (!workspace?.id) return;
      setLoading(true);
      setError(null);
      try {
        const url = new URL(`/api/financeiro/abc`, window.location.origin);
        url.searchParams.set("view", "orders");
        url.searchParams.set("orders_offset", String(off));
        url.searchParams.set("orders_limit", String(size));
        if (status !== "all") url.searchParams.set("orders_status", status);

        const res = await fetch(url.pathname + url.search, {
          headers: { "x-workspace-id": workspace.id },
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as OrdersResponse;
        setData(json);
        if (
          json.period_days &&
          PERIOD_OPTIONS.includes(json.period_days as 7 | 14 | 30 | 60 | 90)
        ) {
          setPeriodDays(json.period_days);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [workspace?.id]
  );

  React.useEffect(() => {
    void load(offset, pageSize, orderFilter);
  }, [load, offset, pageSize, orderFilter]);

  const recompute = async (days: number) => {
    if (!workspace?.id) return;
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch("/api/financeiro/abc/recompute", {
        method: "POST",
        headers: {
          "x-workspace-id": workspace.id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ period_days: days }),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setOffset(0);
      await load(0, pageSize, orderFilter);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecomputing(false);
    }
  };

  const onChangePeriod = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    setPeriodDays(n);
    void recompute(n);
  };

  const summary = data?.summary;
  const orders = data?.orders ?? [];
  const total = data?.orders_total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Lucratividade por pedido
          </h1>
          <p className="text-sm text-muted-foreground">
            P&L pedido a pedido — receita menos CMV, impostos, despesas e frete
            absorvido
            {summary?.period_start && summary?.period_end ? (
              <>
                {" "}
                — {formatDate(summary.period_start)} →{" "}
                {formatDate(summary.period_end)}
              </>
            ) : null}
            .
          </p>
          {data?.computedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Snapshot: {new Date(data.computedAt).toLocaleString("pt-BR")} ·{" "}
              {data.row_count ?? 0} pedidos na janela
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(periodDays)}
            onValueChange={onChangePeriod}
            disabled={recomputing || loading || !workspace?.id}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Últimos {d} dias
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void recompute(periodDays)}
            disabled={recomputing || loading || !workspace?.id}
            variant="outline"
            size="sm"
          >
            {recomputing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="h-4 w-4" />
            )}
            Recalcular
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Erro</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && !summary && data?.message && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p>{data.message}</p>
          </CardContent>
        </Card>
      )}

      {summary && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <KpiCard
              label="Receita"
              value={formatCurrency(summary.total_revenue)}
            />
            <KpiCard
              label="Lucro"
              value={formatCurrency(summary.total_profit)}
              hint={`Margem ${formatPct(summary.gross_margin_pct)}`}
              tone={summary.total_profit >= 0 ? "positive" : "negative"}
            />
            <KpiCard
              label="Pedidos com prejuízo"
              value={summary.loss_orders.toLocaleString("pt-BR")}
              tone={summary.loss_orders > 0 ? "negative" : "neutral"}
            />
            <KpiCard
              label="Pedidos com lucro"
              value={summary.profitable_orders.toLocaleString("pt-BR")}
              hint={`${summary.breakeven_orders} neutros`}
              tone="positive"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Os percentuais usados em cada pedido (impostos, CMV fallback, frete
            médio) vêm de{" "}
            <Link
              href="/simulador-comercial/config"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              Financeiro &rsaquo; Configurações
              <ExternalLink className="h-3 w-3" />
            </Link>
            .
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                active={orderFilter === "all"}
                onClick={() => {
                  setOffset(0);
                  setOrderFilter("all");
                }}
              >
                Todos
              </FilterChip>
              <FilterChip
                active={orderFilter === "loss"}
                onClick={() => {
                  setOffset(0);
                  setOrderFilter("loss");
                }}
              >
                Prejuízo ({summary.loss_orders})
              </FilterChip>
              <FilterChip
                active={orderFilter === "breakeven"}
                onClick={() => {
                  setOffset(0);
                  setOrderFilter("breakeven");
                }}
              >
                Empate ({summary.breakeven_orders})
              </FilterChip>
              <FilterChip
                active={orderFilter === "profit"}
                onClick={() => {
                  setOffset(0);
                  setOrderFilter("profit");
                }}
              >
                Lucro ({summary.profitable_orders})
              </FilterChip>
            </div>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setOffset(0);
                setPageSize(parseInt(v, 10));
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} por página
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Pedido</TableHead>
                    <TableHead className="w-40">Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="w-28 text-right">Valor</TableHead>
                    <TableHead className="w-28 text-right">CMV</TableHead>
                    <TableHead className="w-28 text-right">Imp+Out</TableHead>
                    <TableHead className="w-24 text-right">Frete</TableHead>
                    <TableHead className="w-28 text-right">Lucro</TableHead>
                    <TableHead className="w-20 text-right">Margem</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o, idx) => (
                    <TableRow key={`${o.order_id ?? idx}-${offset + idx}`}>
                      <TableCell className="font-mono text-xs">
                        {o.numero_pedido ?? o.order_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(o.data_compra)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.customer_email ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(o.valor)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(o.items_cost)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(o.taxes + o.other_expenses)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {o.shipping_absorbed > 0
                          ? formatCurrency(o.shipping_absorbed)
                          : "—"}
                      </TableCell>
                      <TableCell
                        className={
                          "text-right " +
                          (o.profit > 0
                            ? "text-success"
                            : o.profit < 0
                              ? "text-destructive"
                              : "text-muted-foreground")
                        }
                      >
                        {formatCurrency(o.profit)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPct(o.margin_pct)}
                      </TableCell>
                      <TableCell>
                        {o.status === "profit" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <TrendingUp className="h-3 w-3" /> Lucro
                          </span>
                        ) : o.status === "loss" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <TrendingDown className="h-3 w-3" /> Prejuízo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Minus className="h-3 w-3" /> Neutro
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {orders.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Nenhum pedido neste filtro.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {total > 0 && (
                <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                  <span>
                    {total.toLocaleString("pt-BR")} pedidos · página{" "}
                    {currentPage} de {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={offset <= 0 || loading}
                      onClick={() => setOffset(Math.max(0, offset - pageSize))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={offset + pageSize >= total || loading}
                      onClick={() => setOffset(offset + pageSize)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition " +
        (active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted-foreground/10")
      }
    >
      {children}
    </button>
  );
}
