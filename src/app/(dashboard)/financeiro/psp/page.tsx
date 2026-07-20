"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleDollarSign,
  Database,
  Download,
  Factory,
  Gauge,
  Layers3,
  Link2,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { PSP_FAMILIES } from "@/lib/psp/defaults";
import type {
  PspAction,
  PspFamily,
  PspPlan,
  PspProductMonitorRow,
  PspSettings,
} from "@/lib/psp/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PspResponse = PspPlan & {
  setup: {
    migration_ready: boolean;
    inventory_refresh_available: boolean;
  };
};

type PlanFilter = "plan" | "outside" | "all";
type ProductDraft = {
  mode: "product" | "base_group";
  sku: string;
  skus: string[];
  family: PspFamily;
  color: string;
  units_per_roll: string;
  lead_time_days: string;
  base_sku: string;
  made_to_order: boolean;
  made_to_order_override: "auto" | "yes" | "no";
};

const FAMILY_LABELS: Record<PspFamily, string> = {
  camiseta: "Camiseta",
  regata: "Regata",
  polo: "Polo",
  bermuda: "Bermuda",
  calca: "Calça",
  blusao: "Blusão",
  moletom: "Moletom",
  jaqueta: "Jaqueta",
  acessorio: "Acessório",
  outro: "Outro",
};

const KIND_LABELS: Record<PspAction["kind"], string> = {
  produce: "Produzir",
  preproduce: "Pré-produzir",
  prepare_base: "Preparar base",
  map_base: "Mapear base",
  verify_stock: "Conferir saldo",
};

const EXCLUDED_LABELS: Record<NonNullable<PspAction["excluded_reason"]>, string> = {
  cash: "Fora por caixa",
  capacity: "Fora por capacidade",
  mapping: "Base não mapeada",
  stock: "Saldo não confirmado",
};

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value, 0)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Sem snapshot";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function gradeText(action: PspAction): string {
  return action.grade
    .filter((item) => item.units > 0)
    .map((item) => `${item.size} ${item.units}`)
    .join(" · ");
}

function actionIcon(kind: PspAction["kind"], className = "h-4 w-4") {
  if (kind === "produce") return <Factory className={className} />;
  if (kind === "preproduce") return <PackageCheck className={className} />;
  if (kind === "prepare_base") return <Layers3 className={className} />;
  if (kind === "map_base") return <Link2 className={className} />;
  return <Database className={className} />;
}

function severityDot(severity: PspAction["severity"]): string {
  if (severity === "critical") return "bg-red-500";
  if (severity === "high") return "bg-amber-500";
  if (severity === "data") return "bg-sky-500";
  return "bg-zinc-400";
}

function actionTone(action: PspAction): string {
  if (action.selected) return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (action.excluded_reason === "mapping" || action.excluded_reason === "stock") {
    return "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
}

function OnDemandBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      Sob demanda
    </Badge>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-r border-border/70 px-4 py-3 last:border-r-0">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ProgressLine({ label, value, detail }: { label: string; value: number; detail: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  const color = bounded >= 90 ? "bg-emerald-500" : bounded >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="grid gap-2 border-b border-border/60 py-4 last:border-b-0 md:grid-cols-[220px_1fr_90px] md:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${bounded}%` }} />
      </div>
      <div className="text-right text-sm font-semibold tabular-nums">{formatNumber(value, 1)}%</div>
    </div>
  );
}

function ActionTable({
  actions,
  onConfigure,
}: {
  actions: PspAction[];
  onConfigure: (action: PspAction) => void;
}) {
  if (actions.length === 0) {
    return <div className="border-y border-border py-16 text-center text-sm text-muted-foreground">Nenhuma ação neste recorte.</div>;
  }
  return (
    <div className="border-y border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="w-[74px]">Prioridade</TableHead>
            <TableHead className="min-w-[280px]">Ação / produto</TableHead>
            <TableHead className="min-w-[260px]">Sinal</TableHead>
            <TableHead className="min-w-[150px]">Estoque</TableHead>
            <TableHead className="min-w-[220px]">Quantidade / grade</TableHead>
            <TableHead className="min-w-[170px]">Caixa / oportunidade</TableHead>
            <TableHead className="min-w-[155px]">Plano</TableHead>
            <TableHead className="w-[48px]"><span className="sr-only">Configurar</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action) => (
            <TableRow key={action.id} className="align-top">
              <TableCell className="pt-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${severityDot(action.severity)}`} />
                  <span className="font-semibold tabular-nums">#{action.rank}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">score {formatNumber(action.priority_score, 0)}</div>
              </TableCell>
              <TableCell className="pt-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background">
                    {actionIcon(action.kind)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{KIND_LABELS[action.kind]}</span>
                      <Badge variant={action.abc_class === "A" ? "default" : action.abc_class === "B" ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                        Curva {action.abc_class}
                      </Badge>
                      {action.made_to_order && <OnDemandBadge />}
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm">{action.name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {action.kind === "map_base" ? "SKU da base ainda não definido" : `SKU ${action.sku}`}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="pt-3">
                <div className="space-y-1 text-xs">
                  {action.reasons.slice(0, 2).map((reason) => (
                    <div key={reason} className="leading-5 text-foreground/85">{reason}</div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>7d {formatNumber(action.sold_7d)}</span>
                  <span>30d {formatNumber(action.sold_30d)}</span>
                  {action.growth_pct != null && (
                    <span className={`inline-flex items-center gap-0.5 ${action.growth_pct > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                      {action.growth_pct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      {formatPercent(action.growth_pct)}
                    </span>
                  )}
                  {action.momentum && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><Sparkles className="h-3 w-3" /> em aceleração</span>}
                </div>
              </TableCell>
              <TableCell className="pt-3">
                <div className="text-base font-semibold tabular-nums">
                  {action.stock_units == null ? "—" : `${formatNumber(action.stock_units)} un.`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {action.coverage_days == null ? "Cobertura indisponível" : `${formatNumber(action.coverage_days, 1)} dias de cobertura`}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {action.stock_source === "eccosys" ? "Eccosys" : action.stock_source === "hub_fallback" ? "Hub deduplicado" : "Sem fonte física"}
                </div>
              </TableCell>
              <TableCell className="pt-3">
                <div className="font-semibold tabular-nums">
                  {action.recommended_units > 0 ? `${formatNumber(action.recommended_units)} un.` : "Aguardando saldo"}
                  {action.recommended_rolls > 0 && <span className="font-normal text-muted-foreground"> · {action.recommended_rolls} {action.recommended_rolls === 1 ? "rolo" : "rolos"}</span>}
                </div>
                {gradeText(action) && <div className="mt-1 max-w-[270px] text-xs leading-5 text-muted-foreground">{gradeText(action)}</div>}
                {action.allocations && action.allocations.length > 0 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {action.allocations.length} {action.allocations.length === 1 ? "estampa alocada" : "estampas alocadas"}
                  </div>
                )}
              </TableCell>
              <TableCell className="pt-3">
                <div className="font-medium tabular-nums">
                  {action.investment_brl == null ? "Custo não mapeado" : formatCurrency(action.investment_brl)}
                </div>
                {action.margin_at_risk_brl > 0 && (
                  <div className="mt-1 text-xs text-red-700 dark:text-red-400">
                    {formatCurrency(action.margin_at_risk_brl)} de margem em risco
                  </div>
                )}
                {action.revenue_at_risk_brl > 0 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">{formatCurrency(action.revenue_at_risk_brl)} de receita</div>
                )}
              </TableCell>
              <TableCell className="pt-3">
                <Badge variant="outline" className={`min-h-6 whitespace-normal px-2 py-1 text-left text-[11px] ${actionTone(action)}`}>
                  {action.selected
                    ? action.selected_units < action.recommended_units
                      ? `Parcial: ${formatNumber(action.selected_units)} un.`
                      : "Dentro do plano"
                    : action.excluded_reason
                      ? EXCLUDED_LABELS[action.excluded_reason]
                      : "Acompanhar"}
                </Badge>
                {action.selected_investment_brl > 0 && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">{formatCurrency(action.selected_investment_brl)} alocado</div>
                )}
              </TableCell>
              <TableCell className="pt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onConfigure(action)}>
                      <Settings2 className="h-4 w-4" />
                      <span className="sr-only">Configurar produto</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Configurar produto</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProductMonitorTable({ rows }: { rows: PspProductMonitorRow[] }) {
  return (
    <div className="border-y border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="min-w-[300px]">Produto</TableHead>
            <TableHead>Curva</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Vendas 7d / 30d</TableHead>
            <TableHead>Crescimento</TableHead>
            <TableHead>Estoque</TableHead>
            <TableHead>Cobertura</TableHead>
            <TableHead>Previsão / dia</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.sku}>
              <TableCell>
                <div className="font-medium">{row.name}</div>
                <div className="text-[11px] text-muted-foreground">{row.sku} · {FAMILY_LABELS[row.family]} · {row.color}</div>
              </TableCell>
              <TableCell><Badge variant={row.abc_class === "A" ? "default" : row.abc_class === "B" ? "secondary" : "outline"}>{row.abc_class}</Badge></TableCell>
              <TableCell>{row.made_to_order ? <OnDemandBadge /> : "Estoque físico"}</TableCell>
              <TableCell className="tabular-nums">{formatNumber(row.sold_7d)} / {formatNumber(row.sold_30d)}</TableCell>
              <TableCell>
                <span className={row.growth_pct != null && row.growth_pct > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                  {formatPercent(row.growth_pct)}
                </span>
                {row.momentum && <Sparkles className="ml-1 inline h-3.5 w-3.5 text-amber-500" />}
              </TableCell>
              <TableCell className="tabular-nums">{row.stock_units == null ? "—" : formatNumber(row.stock_units)}</TableCell>
              <TableCell className="tabular-nums">{row.coverage_days == null ? "—" : `${formatNumber(row.coverage_days, 1)}d`}</TableCell>
              <TableCell className="tabular-nums">{formatNumber(row.forecast_daily, 2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PspPage() {
  const { workspace } = useWorkspace();
  const [data, setData] = React.useState<PspResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [planFilter, setPlanFilter] = React.useState<PlanFilter>("plan");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsDraft, setSettingsDraft] = React.useState<PspSettings | null>(null);
  const [productDraft, setProductDraft] = React.useState<ProductDraft | null>(null);

  const load = React.useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/financeiro/psp", {
        headers: { "x-workspace-id": workspace.id },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const next = body as PspResponse;
      setData(next);
      setSettingsDraft(next.settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar o plano");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refreshInventory = async () => {
    if (!workspace?.id) return;
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/financeiro/psp/refresh", {
        method: "POST",
        headers: { "x-workspace-id": workspace.id },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const requests = Number(body.eccosysRequests) || 1;
      setNotice(
        `${formatNumber(body.count || 0)} SKUs atualizados em ${requests} leitura${requests === 1 ? "" : "s"} do Eccosys.`
      );
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Erro ao atualizar o Eccosys");
    } finally {
      setRefreshing(false);
    }
  };

  const saveSettings = async () => {
    if (!workspace?.id || !settingsDraft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/financeiro/psp", {
        method: "PUT",
        headers: { "x-workspace-id": workspace.id, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "settings", settings: settingsDraft }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSettingsOpen(false);
      setNotice("Limites do plano atualizados.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const openProductConfig = (action: PspAction) => {
    const groupSkus = action.allocations?.map((item) => item.sku) ?? [];
    setProductDraft({
      mode: groupSkus.length > 0 ? "base_group" : "product",
      sku: groupSkus[0] ?? action.sku,
      skus: groupSkus,
      family: action.family,
      color: action.color === "sem cor" ? "" : action.color,
      units_per_roll: String(action.units_per_roll || ""),
      lead_time_days: action.kind === "preproduce" || action.kind === "produce" ? String(data?.settings.production_lead_days ?? "") : "",
      base_sku: action.base_sku ?? "",
      made_to_order: action.made_to_order,
      made_to_order_override: action.made_to_order ? "yes" : "auto",
    });
  };

  const saveProduct = async () => {
    if (!workspace?.id || !productDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = productDraft.mode === "base_group"
        ? {
            type: "base_group",
            skus: productDraft.skus,
            family: productDraft.family,
            color: productDraft.color,
            units_per_roll: productDraft.units_per_roll,
            base_sku: productDraft.base_sku,
          }
        : {
            type: "product",
            sku: productDraft.sku,
            family: productDraft.family,
            color: productDraft.color,
            units_per_roll: productDraft.units_per_roll,
            lead_time_days: productDraft.lead_time_days,
            base_sku: productDraft.base_sku,
            made_to_order_override:
              productDraft.made_to_order_override === "auto"
                ? null
                : productDraft.made_to_order_override === "yes",
          };
      const response = await fetch("/api/financeiro/psp", {
        method: "PUT",
        headers: { "x-workspace-id": workspace.id, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setProductDraft(null);
      setNotice(productDraft.mode === "base_group" ? "Base aplicada ao grupo." : "Produto atualizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar o produto");
    } finally {
      setSaving(false);
    }
  };

  const exportPlan = () => {
    if (!data) return;
    const rows = data.actions.filter((action) => action.selected);
    const csv = [
      ["prioridade", "acao", "sku", "produto", "curva", "sob_demanda", "quantidade", "rolos", "grade", "investimento", "margem_em_risco"],
      ...rows.map((action) => [
        action.rank,
        KIND_LABELS[action.kind],
        action.sku,
        action.name,
        action.abc_class,
        action.made_to_order ? "sim" : "nao",
        action.selected_units,
        action.selected_rolls,
        gradeText(action),
        action.selected_investment_brl,
        action.margin_at_risk_brl,
      ]),
    ]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `plano-producao-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const query = normalizeForSearch(search);
  const filteredActions = React.useMemo(() => {
    if (!data) return [];
    return data.actions.filter((action) => {
      const isPlanBlocker = action.kind === "map_base" || action.kind === "verify_stock";
      if (planFilter === "plan" && !action.selected && !isPlanBlocker) return false;
      if (planFilter === "outside" && (action.selected && action.selected_units >= action.recommended_units)) return false;
      if (!query) return true;
      return normalizeForSearch(`${action.name} ${action.sku} ${action.family} ${action.color} ${KIND_LABELS[action.kind]}`).includes(query);
    });
  }, [data, planFilter, query]);

  const filteredProducts = React.useMemo(() => {
    if (!data) return [];
    if (!query) return data.products;
    return data.products.filter((row) => normalizeForSearch(`${row.name} ${row.sku} ${row.family} ${row.color}`).includes(query));
  }, [data, query]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[440px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border-y border-red-300 bg-red-50 px-4 py-6 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {error || "Não foi possível carregar o planejamento."}
      </div>
    );
  }

  const planCashDetail = data.settings.cash_budget_brl == null
    ? "Caixa ainda sem limite"
    : `de ${formatCurrency(data.settings.cash_budget_brl)}`;

  return (
    <TooltipProvider>
      <div className="space-y-5">
        <header className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Planejamento de produção</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Plano {formatDateTime(data.generated_at)}</span>
              <span>Estoque {formatDateTime(data.data_quality.inventory_captured_at)}</span>
              <span>{formatNumber(data.data_quality.sales_orders)} pedidos analisados</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={refreshInventory} disabled={refreshing || !data.setup.inventory_refresh_available}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Atualizar Eccosys
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={exportPlan}>
                  <Download className="h-4 w-4" />
                  <span className="sr-only">Exportar plano</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar plano</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="sr-only">Limites do plano</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Limites do plano</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {!data.setup.migration_ready && (
          <div className="flex items-start gap-2 border border-sky-300 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Migration 142 pendente. O plano está usando o Hub deduplicado e as configurações ainda não podem ser salvas.</span>
          </div>
        )}

        {(error || notice) && (
          <div className={`flex items-center justify-between gap-3 border px-3 py-2 text-sm ${error ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }} aria-label="Fechar aviso"><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="grid overflow-hidden border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Margem em risco" value={formatCurrency(data.summary.margin_at_risk_brl)} detail={`${data.summary.critical_count} ações críticas`} icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />} />
          <Metric label="Plano selecionado" value={`${data.summary.selected_rolls}/${data.settings.max_rolls_per_order} rolos`} detail={`${data.summary.selected_action_count} ações`} icon={<Factory className="h-3.5 w-3.5 text-zinc-700 dark:text-zinc-300" />} />
          <Metric label="Caixa alocado" value={formatCurrency(data.summary.selected_investment_brl)} detail={planCashDetail} icon={<CircleDollarSign className="h-3.5 w-3.5 text-emerald-600" />} />
          <Metric label="Margem protegida" value={formatCurrency(data.summary.margin_protected_brl)} detail={`${formatCurrency(data.summary.revenue_protected_brl)} em receita`} icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />} />
          <Metric label="Fora do plano" value={formatCurrency(data.summary.opportunity_outside_plan_brl)} detail={`${data.summary.required_rolls - data.summary.selected_rolls} rolos não alocados`} icon={<Gauge className="h-3.5 w-3.5 text-amber-600" />} />
        </section>

        {data.data_quality.warnings.length > 0 && (
          <div className="flex gap-2 border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/25 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {data.data_quality.warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          </div>
        )}

        <Tabs defaultValue="actions">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <TabsList className="w-full justify-start overflow-x-auto md:w-auto">
              <TabsTrigger value="actions">Plano agora</TabsTrigger>
              <TabsTrigger value="on-demand">Sob demanda e bases</TabsTrigger>
              <TabsTrigger value="monitor">Monitor</TabsTrigger>
              <TabsTrigger value="quality">Qualidade dos dados</TabsTrigger>
            </TabsList>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 sm:w-[260px]">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou SKU" className="pl-8" />
              </div>
              <div className="inline-flex h-9 items-center rounded border border-border p-0.5">
                {(["plan", "outside", "all"] as PlanFilter[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPlanFilter(value)}
                    className={`h-8 px-3 text-xs font-medium transition-colors ${planFilter === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {value === "plan" ? "No plano" : value === "outside" ? "Fora" : "Todos"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <TabsContent value="actions" className="mt-4">
            <ActionTable actions={filteredActions.filter((action) => !action.made_to_order || action.kind === "prepare_base" || action.kind === "map_base")} onConfigure={openProductConfig} />
          </TabsContent>
          <TabsContent value="on-demand" className="mt-4">
            <ActionTable actions={filteredActions.filter((action) => action.made_to_order)} onConfigure={openProductConfig} />
          </TabsContent>
          <TabsContent value="monitor" className="mt-4">
            <ProductMonitorTable rows={filteredProducts} />
          </TabsContent>
          <TabsContent value="quality" className="mt-4">
            <div className="border-y border-border px-1">
              <ProgressLine label="Produtos com estoque" value={data.data_quality.stock_match_pct} detail={data.data_quality.inventory_source === "eccosys" ? "Snapshot deduplicado do Eccosys" : "Contingência pelo Hub"} />
              <ProgressLine label="Custos rastreados" value={data.data_quality.tracked_cost_pct} detail="Participação da receita com custo por SKU" />
              <ProgressLine label="Bases vinculadas" value={data.data_quality.mapped_base_pct} detail="Demanda sob demanda ligada ao SKU da base lisa" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="border border-border px-4 py-3"><div className="text-xs text-muted-foreground">Fonte do estoque</div><div className="mt-1 font-semibold">{data.data_quality.inventory_source === "eccosys" ? "Eccosys" : data.data_quality.inventory_source === "hub_fallback" ? "Hub deduplicado" : "Indisponível"}</div></div>
              <div className="border border-border px-4 py-3"><div className="text-xs text-muted-foreground">Idade do estoque</div><div className="mt-1 font-semibold">{data.data_quality.inventory_age_hours == null ? "—" : `${formatNumber(data.data_quality.inventory_age_hours, 1)} horas`}</div></div>
              <div className="border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">Produtos sob demanda</div>
                <div className="mt-1 font-semibold">{formatNumber(data.data_quality.made_to_order_count)} com venda</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{formatNumber(data.data_quality.made_to_order_registered_count)} cadastrados</div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle>Limites do plano</DialogTitle>
            <DialogDescription>Atualização válida para o próximo cálculo.</DialogDescription>
          </DialogHeader>
          {settingsDraft && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Horizonte do estoque (dias)" value={settingsDraft.planning_horizon_days} onChange={(value) => setSettingsDraft({ ...settingsDraft, planning_horizon_days: value })} />
                <NumberField label="Estoque de segurança (dias)" value={settingsDraft.safety_stock_days} onChange={(value) => setSettingsDraft({ ...settingsDraft, safety_stock_days: value })} />
                <NumberField label="Prazo de produção (dias)" value={settingsDraft.production_lead_days} onChange={(value) => setSettingsDraft({ ...settingsDraft, production_lead_days: value })} />
                <NumberField label="Pré-produção sob demanda (dias)" value={settingsDraft.preproduction_days} onChange={(value) => setSettingsDraft({ ...settingsDraft, preproduction_days: value })} />
                <NumberField label="Janela de lançamento (dias)" value={settingsDraft.launch_window_days} onChange={(value) => setSettingsDraft({ ...settingsDraft, launch_window_days: value })} />
                <NumberField label="Mínimo para aceleração (7d)" value={settingsDraft.min_momentum_units_7d} onChange={(value) => setSettingsDraft({ ...settingsDraft, min_momentum_units_7d: value })} />
                <NumberField label="Crescimento mínimo (%)" value={settingsDraft.growth_threshold_pct} onChange={(value) => setSettingsDraft({ ...settingsDraft, growth_threshold_pct: value })} />
              </div>
              <div className="grid gap-4 border-y border-border py-4 sm:grid-cols-2">
                <NumberField label="Máximo de rolos" value={settingsDraft.max_rolls_per_order} onChange={(value) => setSettingsDraft({ ...settingsDraft, max_rolls_per_order: value })} />
                <div className="space-y-2">
                  <Label>Caixa disponível</Label>
                  <Input type="number" min="0" step="100" value={settingsDraft.cash_budget_brl ?? ""} onChange={(event) => setSettingsDraft({ ...settingsDraft, cash_budget_brl: event.target.value === "" ? null : Number(event.target.value) })} />
                </div>
              </div>
              <div>
                <div className="mb-3 text-sm font-semibold">Rendimento por rolo</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PSP_FAMILIES.map((family) => (
                    <NumberField key={family} label={FAMILY_LABELS[family]} value={settingsDraft.family_yields[family]} onChange={(value) => setSettingsDraft({ ...settingsDraft, family_yields: { ...settingsDraft.family_yields, [family]: value } })} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancelar</Button>
            <Button onClick={saveSettings} disabled={saving || !data.setup.migration_ready}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(productDraft)} onOpenChange={(open) => { if (!open) setProductDraft(null); }}>
        <DialogContent className="max-w-xl rounded-lg">
          <DialogHeader>
            <DialogTitle>{productDraft?.mode === "base_group" ? "Configurar base lisa" : "Configurar produto"}</DialogTitle>
            <DialogDescription>{productDraft?.mode === "base_group" ? `${productDraft.skus.length} produtos` : `SKU ${productDraft?.sku ?? ""}`}</DialogDescription>
          </DialogHeader>
          {productDraft && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Família</Label>
                <Select value={productDraft.family} onValueChange={(value) => setProductDraft({ ...productDraft, family: value as PspFamily })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PSP_FAMILIES.map((family) => <SelectItem key={family} value={family}>{FAMILY_LABELS[family]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Cor</Label><Input value={productDraft.color} onChange={(event) => setProductDraft({ ...productDraft, color: event.target.value })} /></div>
              <div className="space-y-2"><Label>Unidades por rolo</Label><Input type="number" min="1" value={productDraft.units_per_roll} onChange={(event) => setProductDraft({ ...productDraft, units_per_roll: event.target.value })} /></div>
              {productDraft.mode === "product" && <div className="space-y-2"><Label>Prazo de produção (dias)</Label><Input type="number" min="1" value={productDraft.lead_time_days} onChange={(event) => setProductDraft({ ...productDraft, lead_time_days: event.target.value })} /></div>}
              {(productDraft.mode === "base_group" || productDraft.made_to_order) && <div className="space-y-2 sm:col-span-2"><Label>SKU da base lisa no Eccosys</Label><Input value={productDraft.base_sku} onChange={(event) => setProductDraft({ ...productDraft, base_sku: event.target.value })} /></div>}
              {productDraft.mode === "product" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Modelo de produção</Label>
                  <Select value={productDraft.made_to_order_override} onValueChange={(value) => setProductDraft({ ...productDraft, made_to_order_override: value as ProductDraft["made_to_order_override"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Usar classificação automática</SelectItem>
                      <SelectItem value="yes" disabled={productDraft.family !== "camiseta" && productDraft.family !== "regata"}>Sob demanda</SelectItem>
                      <SelectItem value="no">Estoque físico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDraft(null)}>Cancelar</Button>
            <Button onClick={saveProduct} disabled={saving || !data.setup.migration_ready || !productDraft?.units_per_roll}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" min="0" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
