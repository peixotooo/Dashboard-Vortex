"use client";

import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  AlertTriangle,
  Calculator,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  period_days?: number;
  row_count?: number;
  computedAt: string | null;
  message?: string;
};

const PERIOD_OPTIONS = [7, 14, 30, 60, 90] as const;

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

export default function CurvaAbcPage() {
  const { workspace } = useWorkspace();
  const [data, setData] = React.useState<AbcResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [classFilter, setClassFilter] = React.useState<"all" | AbcClass>("all");
  const [periodDays, setPeriodDays] = React.useState<number>(30);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/financeiro/abc?view=summary&product_limit=500`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as AbcResponse;
      setData(json);
      if (json.period_days && PERIOD_OPTIONS.includes(json.period_days as 7 | 14 | 30 | 60 | 90)) {
        setPeriodDays(json.period_days);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

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

  const onChangePeriod = (val: string) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return;
    setPeriodDays(n);
    void recompute(n);
  };

  const summary = data?.summary;
  const products = data?.products ?? [];
  const filteredProducts = React.useMemo(() => {
    if (classFilter === "all") return products;
    return products.filter((p) => p.abc_class === classFilter);
  }, [products, classFilter]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Curva ABC</h1>
          <p className="text-sm text-muted-foreground">
            Pareto de produtos por receita
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
            <p>
              Use o botão <strong>Recalcular</strong> acima pra gerar a primeira
              versão.
            </p>
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
              label="Pedidos na janela"
              value={(data?.row_count ?? 0).toLocaleString("pt-BR")}
            />
            <KpiCard
              label="Classe A"
              value={`${summary.a_count}`}
              hint="Top 70% da receita"
            />
            <KpiCard
              label="Classe B / C"
              value={`${summary.b_count} / ${summary.c_count}`}
              hint="20% e 10% restantes"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Curva ABC ranqueia produtos por receita.{" "}
            <Link
              href="/financeiro/lucratividade"
              className="underline underline-offset-2"
            >
              P&L pedido a pedido
            </Link>{" "}
            fica em Lucratividade.
          </p>

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
                    <TableHead className="w-24 text-right">% Receita</TableHead>
                    <TableHead className="w-28 text-right">Acumulado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p, idx) => {
                    const revPct =
                      summary.total_revenue > 0
                        ? p.revenue / summary.total_revenue
                        : 0;
                    return (
                      <TableRow key={`${p.sku ?? p.product_id ?? p.name}-${idx}`}>
                        <TableCell className="text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.sku ?? p.product_id ?? "—"}
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
                          {formatPct(revPct)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatPct(p.cumulative_revenue_pct)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Sem produtos nesta classe.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
