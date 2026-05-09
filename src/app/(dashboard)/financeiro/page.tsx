"use client";

import * as React from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Calculator,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";

type AbcClass = "A" | "B" | "C";

type ProductRow = {
  sku: string | null;
  product_id: string | null;
  name: string;
  qty_sold: number;
  revenue: number;
  cost_unit: number;
  cost_total: number;
  profit: number;
  margin_pct: number;
  abc_class: AbcClass;
  cumulative_revenue_pct: number;
  cost_source: "tracked" | "estimated";
};

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
  total_cost: number;
  total_taxes: number;
  total_other_expenses: number;
  total_shipping_absorbed: number;
  total_profit: number;
  gross_margin_pct: number;
  a_count: number;
  b_count: number;
  c_count: number;
  profitable_orders: number;
  loss_orders: number;
  breakeven_orders: number;
  period_start: string | null;
  period_end: string | null;
  coverage_pct: number;
};

type AbcResponse = {
  summary: Summary | null;
  products: ProductRow[];
  orders?: OrderRow[];
  period_days?: number;
  row_count?: number;
  computedAt: string | null;
  message?: string;
};

function formatPct(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function classBadgeVariant(cls: AbcClass): "default" | "secondary" | "outline" {
  if (cls === "A") return "default";
  if (cls === "B") return "secondary";
  return "outline";
}

export default function FinanceiroPage() {
  const { workspace } = useWorkspace();
  const [data, setData] = React.useState<AbcResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [classFilter, setClassFilter] = React.useState<"all" | AbcClass>("all");
  const [orderFilter, setOrderFilter] = React.useState<
    "all" | "profit" | "loss" | "breakeven"
  >("all");

  const load = React.useCallback(
    async (view: "summary" | "full" = "full") => {
      if (!workspace?.id) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/financeiro/abc?view=${view}&product_limit=500`, {
          headers: { "x-workspace-id": workspace.id },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as AbcResponse;
        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [workspace?.id]
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const onRecompute = async () => {
    if (!workspace?.id) return;
    setRecomputing(true);
    try {
      const res = await fetch("/api/crm/compute", {
        method: "POST",
        headers: { "x-workspace-id": workspace.id },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecomputing(false);
    }
  };

  const summary = data?.summary;
  const products = data?.products ?? [];
  const orders = data?.orders ?? [];

  const filteredProducts = React.useMemo(() => {
    if (classFilter === "all") return products;
    return products.filter((p) => p.abc_class === classFilter);
  }, [products, classFilter]);

  const filteredOrders = React.useMemo(() => {
    const sorted = [...orders].sort((a, b) => a.profit - b.profit);
    if (orderFilter === "all") return sorted;
    return sorted.filter((o) => o.status === orderFilter);
  }, [orders, orderFilter]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Curva ABC e lucratividade por venda — janela{" "}
            {data?.period_days ?? 90} dias
            {summary?.period_start && summary?.period_end ? (
              <>
                {" "}
                ({formatDate(summary.period_start)} →{" "}
                {formatDate(summary.period_end)})
              </>
            ) : null}
            .
          </p>
          {data?.computedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Snapshot: {new Date(data.computedAt).toLocaleString("pt-BR")} ·{" "}
              {data.row_count ?? 0} pedidos
            </p>
          )}
        </div>
        <Button
          onClick={onRecompute}
          disabled={recomputing || loading || !workspace?.id}
          variant="outline"
        >
          {recomputing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Calculator className="h-4 w-4" />
          )}
          Recalcular agora
        </Button>
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
          <CardContent className="p-6 text-sm text-muted-foreground">
            {data.message}
          </CardContent>
        </Card>
      )}

      {summary && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <KpiCard
              label="Receita"
              value={formatCurrency(summary.total_revenue)}
              hint={`${summary.a_count + summary.b_count + summary.c_count} produtos`}
            />
            <KpiCard
              label="Lucro"
              value={formatCurrency(summary.total_profit)}
              hint={`Margem ${formatPct(summary.gross_margin_pct)}`}
              tone={summary.total_profit >= 0 ? "positive" : "negative"}
            />
            <KpiCard
              label="Pedidos no prejuízo"
              value={summary.loss_orders.toLocaleString("pt-BR")}
              hint={`${summary.profitable_orders} com lucro · ${summary.breakeven_orders} neutros`}
              tone={summary.loss_orders > 0 ? "negative" : "neutral"}
            />
            <KpiCard
              label="Cobertura de custo"
              value={formatPct(summary.coverage_pct)}
              hint={
                summary.coverage_pct < 0.5
                  ? "Cadastre custos por SKU pra precisão"
                  : "Receita coberta por product_costs"
              }
              tone={summary.coverage_pct < 0.5 ? "neutral" : "positive"}
            />
          </div>

          <Tabs defaultValue="abc" className="space-y-4">
            <TabsList>
              <TabsTrigger value="abc">Curva ABC</TabsTrigger>
              <TabsTrigger value="orders">Lucratividade por pedido</TabsTrigger>
              <TabsTrigger value="breakdown">Composição de custo</TabsTrigger>
            </TabsList>

            <TabsContent value="abc" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <FilterChip
                  active={classFilter === "all"}
                  onClick={() => setClassFilter("all")}
                >
                  Todos
                </FilterChip>
                <FilterChip
                  active={classFilter === "A"}
                  onClick={() => setClassFilter("A")}
                >
                  A ({summary.a_count})
                </FilterChip>
                <FilterChip
                  active={classFilter === "B"}
                  onClick={() => setClassFilter("B")}
                >
                  B ({summary.b_count})
                </FilterChip>
                <FilterChip
                  active={classFilter === "C"}
                  onClick={() => setClassFilter("C")}
                >
                  C ({summary.c_count})
                </FilterChip>
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="w-20">Classe</TableHead>
                        <TableHead className="w-20 text-right">Qtd</TableHead>
                        <TableHead className="w-32 text-right">Receita</TableHead>
                        <TableHead className="w-32 text-right">Custo</TableHead>
                        <TableHead className="w-32 text-right">Lucro</TableHead>
                        <TableHead className="w-24 text-right">Margem</TableHead>
                        <TableHead className="w-28 text-right">Acumulado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((p, idx) => (
                        <TableRow key={`${p.sku ?? p.product_id ?? p.name}-${idx}`}>
                          <TableCell className="text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.sku ?? p.product_id ?? "—"}
                              {p.cost_source === "estimated" && (
                                <span className="ml-2 italic">
                                  custo estimado
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={classBadgeVariant(p.abc_class)}>
                              {p.abc_class}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.qty_sold.toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(p.revenue)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatCurrency(p.cost_total)}
                          </TableCell>
                          <TableCell
                            className={
                              "text-right " +
                              (p.profit >= 0 ? "text-green-700" : "text-red-700")
                            }
                          >
                            {formatCurrency(p.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatPct(p.margin_pct)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatPct(p.cumulative_revenue_pct)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredProducts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                            Sem produtos nesta classe.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="orders" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <FilterChip
                  active={orderFilter === "all"}
                  onClick={() => setOrderFilter("all")}
                >
                  Todos
                </FilterChip>
                <FilterChip
                  active={orderFilter === "loss"}
                  onClick={() => setOrderFilter("loss")}
                >
                  Prejuízo ({summary.loss_orders})
                </FilterChip>
                <FilterChip
                  active={orderFilter === "breakeven"}
                  onClick={() => setOrderFilter("breakeven")}
                >
                  Empate ({summary.breakeven_orders})
                </FilterChip>
                <FilterChip
                  active={orderFilter === "profit"}
                  onClick={() => setOrderFilter("profit")}
                >
                  Lucro ({summary.profitable_orders})
                </FilterChip>
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">Pedido</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="w-28">Data</TableHead>
                        <TableHead className="w-28 text-right">Valor</TableHead>
                        <TableHead className="w-28 text-right">CMV</TableHead>
                        <TableHead className="w-28 text-right">Imp+Out</TableHead>
                        <TableHead className="w-28 text-right">Frete</TableHead>
                        <TableHead className="w-28 text-right">Lucro</TableHead>
                        <TableHead className="w-24 text-right">Margem</TableHead>
                        <TableHead className="w-20">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.slice(0, 200).map((o, idx) => (
                        <TableRow key={`${o.order_id ?? idx}`}>
                          <TableCell className="font-mono text-xs">
                            {o.numero_pedido ?? o.order_id ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {o.customer_email ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(o.data_compra)}
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
                                ? "text-green-700"
                                : o.profit < 0
                                  ? "text-red-700"
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
                              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                <TrendingUp className="h-3 w-3" /> Lucro
                              </span>
                            ) : o.status === "loss" ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-700">
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
                      {filteredOrders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                            Nenhum pedido neste filtro.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {filteredOrders.length > 200 && (
                    <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                      Mostrando 200 de {filteredOrders.length} pedidos.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="breakdown" className="space-y-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Onde o dinheiro foi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <BreakdownRow
                    label="Receita líquida"
                    value={summary.total_revenue}
                    base={summary.total_revenue}
                    tone="positive"
                  />
                  <BreakdownRow
                    label="Custo dos produtos (CMV)"
                    value={summary.total_cost}
                    base={summary.total_revenue}
                    tone="negative"
                  />
                  <BreakdownRow
                    label="Impostos"
                    value={summary.total_taxes}
                    base={summary.total_revenue}
                    tone="negative"
                  />
                  <BreakdownRow
                    label="Outras despesas variáveis"
                    value={summary.total_other_expenses}
                    base={summary.total_revenue}
                    tone="negative"
                  />
                  <BreakdownRow
                    label="Frete absorvido (frete grátis)"
                    value={summary.total_shipping_absorbed}
                    base={summary.total_revenue}
                    tone="negative"
                  />
                  <div className="border-t pt-3">
                    <BreakdownRow
                      label="Lucro / margem de contribuição"
                      value={summary.total_profit}
                      base={summary.total_revenue}
                      tone={summary.total_profit >= 0 ? "positive" : "negative"}
                      bold
                    />
                  </div>
                  <p className="pt-2 text-xs text-muted-foreground">
                    % aplicadas vêm de{" "}
                    <a
                      href="/simulador-comercial/config"
                      className="underline underline-offset-2"
                    >
                      Comercial → Configurações
                    </a>
                    . Custos por SKU são gerenciados em{" "}
                    <code className="rounded bg-muted px-1">product_costs</code>{" "}
                    (UI dedicada em backlog).
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
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
      ? "text-green-700"
      : tone === "negative"
        ? "text-red-700"
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

function BreakdownRow({
  label,
  value,
  base,
  tone,
  bold,
}: {
  label: string;
  value: number;
  base: number;
  tone: "positive" | "negative";
  bold?: boolean;
}) {
  const pct = base > 0 ? value / base : 0;
  const sign = tone === "negative" ? "−" : "";
  const toneClass = tone === "positive" ? "text-green-700" : "text-red-700";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={bold ? "font-semibold" : "text-sm"}>{label}</span>
      <div className="flex items-baseline gap-3">
        <span className={`text-sm ${toneClass}`}>
          {sign}
          {formatCurrency(Math.abs(value))}
        </span>
        <span className="w-14 text-right text-xs text-muted-foreground">
          {formatPct(pct)}
        </span>
      </div>
    </div>
  );
}
