"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Factory,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Shirt,
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

const GROUP_LABELS = {
  bases: "Reposição de bases",
  on_demand: "Sob demanda",
  stock: "Estoque físico",
  pending: "Pendências",
} as const;

type StatusTone = "ok" | "partial" | "blocked" | "info" | "muted";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  partial: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  blocked: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  info: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  muted: "border-border bg-muted/40 text-muted-foreground",
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

function planStatus(action: PspAction): { label: string; tone: StatusTone } {
  if (action.kind === "map_base") return { label: "Vincular base", tone: "blocked" };
  if (action.kind === "verify_stock") return { label: "Conferir saldo", tone: "blocked" };
  if (action.kind === "prepare_base" && action.selected && action.recommended_units === 0) {
    return { label: "Base disponível", tone: "ok" };
  }
  if (action.selected && action.selected_units >= action.recommended_units) {
    return { label: "No plano", tone: "ok" };
  }
  if (action.selected) {
    return { label: `Parcial · ${formatNumber(action.selected_units)} un.`, tone: "partial" };
  }
  if (action.excluded_reason === "mapping") return { label: "Aguardando base", tone: "info" };
  if (action.excluded_reason === "stock") return { label: "Saldo não confirmado", tone: "info" };
  if (action.excluded_reason === "cash") return { label: "Fora por caixa", tone: "partial" };
  if (action.excluded_reason === "capacity") return { label: "Fora por capacidade", tone: "partial" };
  return { label: "Acompanhar", tone: "muted" };
}

function coverageTone(action: PspAction): string {
  if (action.severity === "critical") return "text-red-700 dark:text-red-400";
  if (action.severity === "high") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

function planUnits(action: PspAction): number {
  if (action.selected_units > 0) return action.selected_units;
  return action.recommended_units;
}

function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function CurveBadge({ abc }: { abc: PspAction["abc_class"] }) {
  return (
    <Badge
      variant={abc === "A" ? "default" : abc === "B" ? "secondary" : "outline"}
      className="h-5 px-1.5 text-[10px]"
    >
      {abc}
    </Badge>
  );
}

function StatusChip({ action }: { action: PspAction }) {
  const status = planStatus(action);
  return (
    <Badge
      variant="outline"
      className={`min-h-6 justify-center whitespace-nowrap px-2 py-1 text-[11px] ${STATUS_TONE_CLASS[status.tone]}`}
    >
      {status.label}
    </Badge>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1.5 space-y-1 text-sm">{children}</div>
    </div>
  );
}

function ActionDetail({
  action,
  onConfigure,
}: {
  action: PspAction;
  onConfigure: (action: PspAction) => void;
}) {
  const grade = action.grade.filter((item) => item.units > 0);
  return (
    <div className="space-y-4 border-t border-border/60 bg-muted/20 px-4 py-4">
      <div className="grid gap-4 md:grid-cols-3">
        <DetailBlock title="Sinal de venda">
          <div className="tabular-nums">
            7d {formatNumber(action.sold_7d)} · 30d {formatNumber(action.sold_30d)}
            {action.growth_pct != null && (
              <span className={`ml-2 inline-flex items-center gap-0.5 ${action.growth_pct > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                {action.growth_pct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {formatPercent(action.growth_pct)}
              </span>
            )}
          </div>
          {action.momentum && (
            <div className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Sparkles className="h-3 w-3" /> Em aceleração
            </div>
          )}
          {action.reasons.map((reason) => (
            <div key={reason} className="text-xs leading-5 text-muted-foreground">{reason}</div>
          ))}
        </DetailBlock>
        <DetailBlock title="Estoque">
          <div className="tabular-nums">
            {action.stock_units == null ? "Sem saldo localizado" : `${formatNumber(action.stock_units)} un. disponíveis`}
          </div>
          <div className="text-xs text-muted-foreground">
            {action.coverage_days == null ? "Cobertura indisponível" : `${formatNumber(action.coverage_days, 1)} dias de cobertura`}
          </div>
          <div className="text-xs text-muted-foreground">
            Fonte: {action.stock_source === "eccosys" ? "Eccosys" : action.stock_source === "hub_fallback" ? "Hub deduplicado" : "sem fonte física"}
          </div>
          {action.base_sku && (
            <div className="text-xs text-muted-foreground">Base: {action.base_sku}</div>
          )}
        </DetailBlock>
        <DetailBlock title="Produção e caixa">
          <div className="tabular-nums">
            Recomendado {formatNumber(action.recommended_units)} un.
            {action.recommended_rolls > 0 && ` (${action.recommended_rolls} ${action.recommended_rolls === 1 ? "rolo" : "rolos"})`}
          </div>
          {action.selected_units > 0 && action.selected_units !== action.recommended_units && (
            <div className="text-xs text-muted-foreground">No plano: {formatNumber(action.selected_units)} un.</div>
          )}
          <div className="text-xs text-muted-foreground">
            {action.investment_brl == null ? "Custo não mapeado" : `Investimento ${formatCurrency(action.investment_brl)}`}
          </div>
          {action.margin_at_risk_brl > 0 && (
            <div className="text-xs text-red-700 dark:text-red-400">
              {formatCurrency(action.margin_at_risk_brl)} de margem em risco
            </div>
          )}
        </DetailBlock>
      </div>
      {grade.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Grade sugerida</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {grade.map((item) => (
              <span key={item.size} className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs tabular-nums">
                <span className="font-semibold">{item.size}</span> {formatNumber(item.units)}
              </span>
            ))}
          </div>
        </div>
      )}
      {action.allocations && action.allocations.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {action.allocations.length === 1 ? "Estampa que depende desta base" : `${action.allocations.length} estampas que dependem desta base`}
          </div>
          <div className="mt-1.5 space-y-1">
            {action.allocations.map((item) => (
              <div key={item.sku} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(item.units)} un.</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => onConfigure(action)}>
          <Settings2 className="mr-2 h-3.5 w-3.5" />
          Configurar
        </Button>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  expanded,
  onToggle,
  onConfigure,
}: {
  action: PspAction;
  expanded: boolean;
  onToggle: () => void;
  onConfigure: (action: PspAction) => void;
}) {
  const units = planUnits(action);
  const rolls = action.selected_rolls > 0 ? action.selected_rolls : action.recommended_rolls;
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_150px_16px]"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{action.name}</span>
            <CurveBadge abc={action.abc_class} />
            {action.momentum && <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {action.kind === "map_base" ? "SKU da base ainda não definido" : `SKU ${action.sku}`}
          </div>
        </div>
        <div className="text-right md:text-left">
          <div className="text-sm font-semibold tabular-nums">
            {units > 0 ? `${formatNumber(units)} un.` : "—"}
          </div>
          {rolls > 0 && (
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {rolls} {rolls === 1 ? "rolo" : "rolos"}
            </div>
          )}
        </div>
        <div className="hidden min-w-0 text-xs md:block">
          {action.kind === "produce" && (
            <span className={`tabular-nums ${coverageTone(action)}`}>
              {action.coverage_days == null ? "Cobertura indisponível" : `${formatNumber(action.coverage_days, 1)}d de cobertura`}
              {action.stock_units != null && <span className="text-muted-foreground"> · {formatNumber(action.stock_units)} un.</span>}
            </span>
          )}
          {action.kind === "preproduce" && (
            <span className="tabular-nums text-muted-foreground">
              7d {formatNumber(action.sold_7d)} · 30d {formatNumber(action.sold_30d)}
              {action.growth_pct != null && action.growth_pct > 0 && (
                <span className="ml-1.5 text-emerald-700 dark:text-emerald-400">{formatPercent(action.growth_pct)}</span>
              )}
            </span>
          )}
          {(action.kind === "prepare_base" || action.kind === "map_base") && (
            <span className="tabular-nums text-muted-foreground">
              {action.stock_units == null ? "Sem saldo de base" : `${formatNumber(action.stock_units)} bases em estoque`}
              {action.allocations && ` · ${action.allocations.length} ${action.allocations.length === 1 ? "estampa" : "estampas"}`}
            </span>
          )}
          {action.kind === "verify_stock" && (
            <span className="text-muted-foreground">Saldo físico não localizado no Eccosys</span>
          )}
        </div>
        <div className="hidden justify-self-end md:block">
          <StatusChip action={action} />
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div className="px-4 pb-2 md:hidden">
        <StatusChip action={action} />
      </div>
      {expanded && <ActionDetail action={action} onConfigure={onConfigure} />}
    </div>
  );
}

function SectionShell({
  id,
  icon,
  title,
  summary,
  tone,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  summary: string;
  tone?: "default" | "warning";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card">
      <div className={`flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 ${tone === "warning" ? "bg-amber-50/70 dark:bg-amber-950/25" : "bg-muted/30"}`}>
        <span className={`flex h-7 w-7 items-center justify-center rounded border border-border bg-background ${tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      {text}
    </div>
  );
}

function HiddenGroup({
  label,
  actions,
  expandedIds,
  onToggleRow,
  onConfigure,
}: {
  label: string;
  actions: PspAction[];
  expandedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onConfigure: (action: PspAction) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (actions.length === 0) return null;
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {label} ({actions.length})
      </button>
      {open && (
        <div className="border-t border-border/60">
          {actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              expanded={expandedIds.has(action.id)}
              onToggle={() => onToggleRow(action.id)}
              onConfigure={onConfigure}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 ${tone === "warning" ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/25" : "border-border bg-card"}`}
    >
      <div className={`flex items-center gap-2 text-xs font-medium ${tone === "warning" ? "text-amber-900 dark:text-amber-300" : "text-muted-foreground"}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</div>
      <div className={`mt-1 truncate text-xs ${tone === "warning" ? "text-amber-900/80 dark:text-amber-300/80" : "text-muted-foreground"}`}>{detail}</div>
    </button>
  );
}

function DisclosureSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge && (
            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${STATUS_TONE_CLASS.partial}`}>
              {badge}
            </Badge>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function ProgressLine({ label, value, detail }: { label: string; value: number; detail: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  const color = bounded >= 90 ? "bg-emerald-500" : bounded >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="grid gap-2 border-b border-border/60 px-4 py-4 last:border-b-0 md:grid-cols-[220px_1fr_90px] md:items-center">
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

function ProductMonitorTable({ rows }: { rows: PspProductMonitorRow[] }) {
  return (
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
            <TableCell className="text-xs">{row.made_to_order ? "Sob demanda" : "Estoque físico"}</TableCell>
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
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
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

  const query = normalizeForSearch(search);
  const groups = React.useMemo(() => {
    const actions = data?.actions ?? [];
    const matches = (action: PspAction) =>
      !query ||
      normalizeForSearch(`${action.name} ${action.sku} ${action.family} ${action.color} ${KIND_LABELS[action.kind]}`).includes(query);
    const bases = actions.filter((action) => action.kind === "prepare_base" && matches(action));
    const onDemand = actions.filter((action) => action.kind === "preproduce" && matches(action));
    const stock = actions.filter((action) => action.kind === "produce" && matches(action));
    const pending = actions.filter(
      (action) => (action.kind === "map_base" || action.kind === "verify_stock") && matches(action)
    );
    return {
      basesToRestock: bases.filter((action) => action.recommended_units > 0),
      basesReady: bases.filter((action) => action.recommended_units === 0),
      onDemandActive: onDemand.filter((action) => action.excluded_reason !== "mapping"),
      onDemandWaiting: onDemand.filter((action) => action.excluded_reason === "mapping"),
      stockInPlan: stock.filter((action) => action.selected),
      stockOutside: stock.filter((action) => !action.selected),
      pending,
    };
  }, [data, query]);

  const toggleRow = React.useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyList = async () => {
    if (!data) return;
    const date = new Date(data.generated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const lineFor = (action: PspAction) => {
      const units = planUnits(action);
      const rolls = action.selected_rolls > 0 ? action.selected_rolls : action.recommended_rolls;
      const parts = [
        `• ${action.sku ? `[${action.sku.toUpperCase()}] ` : ""}${action.name} — ${formatNumber(units)} un.`,
      ];
      if (rolls > 0) parts.push(`(${rolls} ${rolls === 1 ? "rolo" : "rolos"})`);
      const grade = gradeText(action);
      if (grade) parts.push(`— ${grade}`);
      return parts.join(" ");
    };
    const sections: string[] = [`*PLANO DE PRODUÇÃO — ${date}*`];
    const basesToCopy = groups.basesToRestock.filter((action) => planUnits(action) > 0);
    if (basesToCopy.length > 0) {
      sections.push(["*REPOR BASES*", ...basesToCopy.map(lineFor)].join("\n"));
    }
    const onDemandToCopy = groups.onDemandActive.filter((action) => planUnits(action) > 0);
    if (onDemandToCopy.length > 0) {
      sections.push(["*SOB DEMANDA — PRÉ-PRODUZIR*", ...onDemandToCopy.map(lineFor)].join("\n"));
    }
    const stockToCopy = groups.stockInPlan.filter((action) => planUnits(action) > 0);
    if (stockToCopy.length > 0) {
      sections.push(["*ESTOQUE FÍSICO — PRODUZIR*", ...stockToCopy.map(lineFor)].join("\n"));
    }
    const pendingBits: string[] = [];
    const mapCount = groups.pending.filter((action) => action.kind === "map_base").length;
    const stockCount = groups.pending.filter((action) => action.kind === "verify_stock").length;
    if (mapCount > 0) pendingBits.push(`${mapCount} ${mapCount === 1 ? "base sem SKU vinculado" : "bases sem SKU vinculado"}`);
    if (stockCount > 0) pendingBits.push(`${stockCount} ${stockCount === 1 ? "produto sem saldo confirmado" : "produtos sem saldo confirmado"}`);
    if (groups.onDemandWaiting.length > 0) pendingBits.push(`${groups.onDemandWaiting.length} sob demanda aguardando base`);
    if (pendingBits.length > 0) sections.push(`Pendências: ${pendingBits.join(" · ")}`);
    try {
      await navigator.clipboard.writeText(sections.join("\n\n"));
      setNotice("Lista de produção copiada.");
    } catch {
      setError("Não foi possível copiar a lista.");
    }
  };

  const exportPlan = () => {
    if (!data) return;
    const groupLabel = (action: PspAction) => {
      if (action.kind === "prepare_base" || action.kind === "map_base") return GROUP_LABELS.bases;
      if (action.kind === "preproduce") return GROUP_LABELS.on_demand;
      if (action.kind === "produce") return GROUP_LABELS.stock;
      return GROUP_LABELS.pending;
    };
    const csv = [
      ["grupo", "status", "acao", "sku", "produto", "curva", "sob_demanda", "quantidade_plano", "quantidade_recomendada", "rolos", "grade", "investimento", "margem_em_risco"],
      ...data.actions.map((action) => [
        groupLabel(action),
        planStatus(action).label,
        KIND_LABELS[action.kind],
        action.sku,
        action.name,
        action.abc_class,
        action.made_to_order ? "sim" : "nao",
        action.selected_units,
        action.recommended_units,
        action.selected_rolls > 0 ? action.selected_rolls : action.recommended_rolls,
        gradeText(action),
        action.selected_investment_brl || action.investment_brl || "",
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

  const sumUnits = (actions: PspAction[]) => actions.reduce((sum, action) => sum + planUnits(action), 0);
  const sumRolls = (actions: PspAction[]) =>
    actions.reduce((sum, action) => sum + (action.selected_rolls > 0 ? action.selected_rolls : action.recommended_rolls), 0);
  const sumInvestment = (actions: PspAction[]) =>
    actions.reduce((sum, action) => sum + (action.selected_investment_brl || action.investment_brl || 0), 0);

  const baseUnits = sumUnits(groups.basesToRestock);
  const baseRolls = sumRolls(groups.basesToRestock);
  const onDemandUnits = sumUnits(groups.onDemandActive);
  const stockUnits = sumUnits(groups.stockInPlan);
  const stockRolls = sumRolls(groups.stockInPlan);
  const pendingCount = groups.pending.length + groups.onDemandWaiting.length;

  const planCashDetail = data.settings.cash_budget_brl == null
    ? "sem limite de caixa definido"
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={refreshInventory} disabled={refreshing || !data.setup.inventory_refresh_available}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Atualizar Eccosys
            </Button>
            <Button onClick={copyList}>
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copiar lista
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={exportPlan}>
                  <Download className="h-4 w-4" />
                  <span className="sr-only">Exportar CSV completo</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar CSV completo</TooltipContent>
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
          <div className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Migration 142 pendente. O plano está usando o Hub deduplicado e as configurações ainda não podem ser salvas.</span>
          </div>
        )}

        {(error || notice) && (
          <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${error ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }} aria-label="Fechar aviso"><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GroupCard
            icon={<Layers3 className="h-3.5 w-3.5" />}
            label="Repor bases"
            value={`${formatNumber(baseUnits)} un.`}
            detail={`${groups.basesToRestock.length} ${groups.basesToRestock.length === 1 ? "base" : "bases"} · ${baseRolls} ${baseRolls === 1 ? "rolo" : "rolos"} · ${formatCurrency(sumInvestment(groups.basesToRestock))}`}
            onClick={() => scrollTo("psp-bases")}
          />
          <GroupCard
            icon={<Shirt className="h-3.5 w-3.5" />}
            label="Sob demanda"
            value={`${formatNumber(onDemandUnits)} un.`}
            detail={`${groups.onDemandActive.length} ${groups.onDemandActive.length === 1 ? "produto" : "produtos"} para pré-produzir`}
            onClick={() => scrollTo("psp-on-demand")}
          />
          <GroupCard
            icon={<Factory className="h-3.5 w-3.5" />}
            label="Estoque físico"
            value={`${formatNumber(stockUnits)} un.`}
            detail={`${groups.stockInPlan.length} ${groups.stockInPlan.length === 1 ? "produto" : "produtos"} · ${stockRolls} ${stockRolls === 1 ? "rolo" : "rolos"} · ${formatCurrency(sumInvestment(groups.stockInPlan))}`}
            onClick={() => scrollTo("psp-stock")}
          />
          <GroupCard
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Pendências"
            value={formatNumber(pendingCount)}
            detail={pendingCount === 0 ? "Nada bloqueando o plano" : "Itens bloqueando o plano"}
            tone={pendingCount > 0 ? "warning" : "default"}
            onClick={() => scrollTo(pendingCount > 0 ? "psp-pending" : "psp-bases")}
          />
        </section>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Margem em risco <span className="font-semibold text-foreground">{formatCurrency(data.summary.margin_at_risk_brl)}</span></span>
            <span>Protegida <span className="font-semibold text-foreground">{formatCurrency(data.summary.margin_protected_brl)}</span></span>
            <span>Caixa <span className="font-semibold text-foreground">{formatCurrency(data.summary.selected_investment_brl)}</span> {planCashDetail}</span>
            <span>Rolos <span className="font-semibold text-foreground">{data.summary.selected_rolls}/{data.settings.max_rolls_per_order}</span></span>
            {data.summary.opportunity_outside_plan_brl > 0 && (
              <span>Fora do plano <span className="font-semibold text-foreground">{formatCurrency(data.summary.opportunity_outside_plan_brl)}</span></span>
            )}
          </div>
          <div className="relative w-full md:w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou SKU" className="pl-8" />
          </div>
        </div>

        <SectionShell
          id="psp-bases"
          icon={<Layers3 className="h-4 w-4" />}
          title="Repor bases"
          summary={groups.basesToRestock.length === 0 ? "nenhuma reposição necessária" : `${groups.basesToRestock.length} ${groups.basesToRestock.length === 1 ? "base" : "bases"} · ${formatNumber(baseUnits)} un.`}
        >
          {groups.basesToRestock.length === 0 ? (
            <EmptyLine text="Nenhuma base precisa de reposição agora." />
          ) : (
            groups.basesToRestock.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                expanded={expandedIds.has(action.id)}
                onToggle={() => toggleRow(action.id)}
                onConfigure={openProductConfig}
              />
            ))
          )}
          <HiddenGroup
            label="Bases com estoque suficiente"
            actions={groups.basesReady}
            expandedIds={expandedIds}
            onToggleRow={toggleRow}
            onConfigure={openProductConfig}
          />
        </SectionShell>

        <SectionShell
          id="psp-on-demand"
          icon={<Shirt className="h-4 w-4" />}
          title="Sob demanda — pré-produzir"
          summary={groups.onDemandActive.length === 0 ? "nenhuma pré-produção necessária" : `${groups.onDemandActive.length} ${groups.onDemandActive.length === 1 ? "produto" : "produtos"} · ${formatNumber(onDemandUnits)} un.`}
        >
          {groups.onDemandActive.length === 0 ? (
            <EmptyLine text="Nenhum produto sob demanda precisa de pré-produção agora." />
          ) : (
            groups.onDemandActive.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                expanded={expandedIds.has(action.id)}
                onToggle={() => toggleRow(action.id)}
                onConfigure={openProductConfig}
              />
            ))
          )}
          <HiddenGroup
            label="Aguardando base ser vinculada"
            actions={groups.onDemandWaiting}
            expandedIds={expandedIds}
            onToggleRow={toggleRow}
            onConfigure={openProductConfig}
          />
        </SectionShell>

        <SectionShell
          id="psp-stock"
          icon={<Factory className="h-4 w-4" />}
          title="Estoque físico — produzir"
          summary={groups.stockInPlan.length === 0 ? "nenhuma produção no plano" : `${groups.stockInPlan.length} ${groups.stockInPlan.length === 1 ? "produto" : "produtos"} · ${formatNumber(stockUnits)} un. · ${stockRolls} ${stockRolls === 1 ? "rolo" : "rolos"}`}
        >
          {groups.stockInPlan.length === 0 ? (
            <EmptyLine text="Nenhum produto de estoque físico entrou no plano." />
          ) : (
            groups.stockInPlan.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                expanded={expandedIds.has(action.id)}
                onToggle={() => toggleRow(action.id)}
                onConfigure={openProductConfig}
              />
            ))
          )}
          <HiddenGroup
            label="Fora do plano (caixa ou capacidade)"
            actions={groups.stockOutside}
            expandedIds={expandedIds}
            onToggleRow={toggleRow}
            onConfigure={openProductConfig}
          />
        </SectionShell>

        {groups.pending.length > 0 && (
          <SectionShell
            id="psp-pending"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Pendências"
            summary={`${groups.pending.length} ${groups.pending.length === 1 ? "item bloqueando" : "itens bloqueando"} o plano`}
            tone="warning"
          >
            {groups.pending.map((action) => (
              <div key={action.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{action.name}</span>
                    <CurveBadge abc={action.abc_class} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {action.kind === "map_base"
                      ? `Vincule o SKU da base lisa${action.allocations ? ` · ${action.allocations.length} ${action.allocations.length === 1 ? "estampa depende" : "estampas dependem"} dela` : ""}`
                      : "Saldo físico não localizado no snapshot do Eccosys"}
                  </div>
                </div>
                <StatusChip action={action} />
                <Button variant="outline" size="sm" onClick={() => openProductConfig(action)}>
                  <Settings2 className="mr-2 h-3.5 w-3.5" />
                  {action.kind === "map_base" ? "Vincular base" : "Configurar"}
                </Button>
              </div>
            ))}
          </SectionShell>
        )}

        <div className="space-y-3">
          <DisclosureSection title={`Monitor de produtos (${formatNumber(filteredProducts.length)})`}>
            <div className="overflow-x-auto">
              <ProductMonitorTable rows={filteredProducts} />
            </div>
          </DisclosureSection>

          <DisclosureSection
            title="Qualidade dos dados"
            badge={data.data_quality.warnings.length > 0 ? `${data.data_quality.warnings.length} ${data.data_quality.warnings.length === 1 ? "aviso" : "avisos"}` : undefined}
          >
            {data.data_quality.warnings.length > 0 && (
              <div className="space-y-1 border-b border-border/60 bg-amber-50/70 px-4 py-3 text-xs text-amber-950 dark:bg-amber-950/25 dark:text-amber-200">
                {data.data_quality.warnings.map((warning) => (
                  <div key={warning} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
            <ProgressLine label="Produtos com estoque" value={data.data_quality.stock_match_pct} detail={data.data_quality.inventory_source === "eccosys" ? "Snapshot deduplicado do Eccosys" : "Contingência pelo Hub"} />
            <ProgressLine label="Custos rastreados" value={data.data_quality.tracked_cost_pct} detail="Participação da receita com custo por SKU" />
            <ProgressLine label="Bases vinculadas" value={data.data_quality.mapped_base_pct} detail="Demanda sob demanda ligada ao SKU da base lisa" />
            <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
              <div className="rounded border border-border px-4 py-3"><div className="text-xs text-muted-foreground">Fonte do estoque</div><div className="mt-1 font-semibold">{data.data_quality.inventory_source === "eccosys" ? "Eccosys" : data.data_quality.inventory_source === "hub_fallback" ? "Hub deduplicado" : "Indisponível"}</div></div>
              <div className="rounded border border-border px-4 py-3"><div className="text-xs text-muted-foreground">Idade do estoque</div><div className="mt-1 font-semibold">{data.data_quality.inventory_age_hours == null ? "—" : `${formatNumber(data.data_quality.inventory_age_hours, 1)} horas`}</div></div>
              <div className="rounded border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">Produtos sob demanda</div>
                <div className="mt-1 font-semibold">{formatNumber(data.data_quality.made_to_order_count)} com venda</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{formatNumber(data.data_quality.made_to_order_registered_count)} cadastrados</div>
              </div>
            </div>
          </DisclosureSection>
        </div>
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
