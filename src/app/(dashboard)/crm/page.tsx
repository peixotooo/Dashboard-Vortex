"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Users,
  DollarSign,
  CircleDollarSign,
  UserCheck,
  Search,
  Loader2,
  Download,
  FileSpreadsheet,
  X,
  CalendarIcon,
  SlidersHorizontal,
  Bot,
  ShieldOff,
  RefreshCw,
  MessageSquareMore,
  Mail,
  FileText,
  Plus,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import type {
  RfmCustomer, RfmSegmentSummary, RfmSegment, CrmRfmResponse,
  DayRange, DayOfWeekPref, HourPref, CouponSensitivity, LifecycleStage, Weekday,
  MonthlyCohortRow,
} from "@/lib/crm-rfm";
import { SEGMENT_META, LIFECYCLE_META, COUPON_META, WEEKDAY_META } from "@/lib/crm-rfm";
import { CrmAgentPanel } from "@/components/crm/crm-agent-panel";
import type { CrmFilters } from "@/components/crm/crm-agent-panel";
import { CampaignCreateDialog } from "@/components/crm/campaign-create-dialog";
import { TemplateCreateDialog } from "@/components/crm/template-create-dialog";
import { EmailListCreateDialog } from "@/components/crm/email-list-create-dialog";
import { StateTilemap, STATE_NAMES, type UF } from "@/components/crm/state-tilemap";
import { useChartTheme } from "@/hooks/use-chart-theme";

// --- Constants ---

const emptySummary: CrmRfmResponse["summary"] = {
  totalCustomers: 0, totalRevenue: 0, avgTicket: 0,
  activeCustomers: 0, avgPurchasesPerCustomer: 0, medianRecency: 0,
};

const emptyDistributions: CrmRfmResponse["distributions"] = {
  recency: [], frequency: [], monetary: [],
};

const emptyBehavioral: CrmRfmResponse["behavioralDistributions"] = {
  dayOfMonth: [], dayOfWeek: [], weekday: [], hourOfDay: [], couponUsage: [], lifecycle: [],
};

// --- Reverse lookups: chart bucket label → filter key ---

const WEEKDAY_LABEL_TO_KEY: Record<string, Weekday> = Object.fromEntries(
  Object.entries(WEEKDAY_META).map(([k, v]) => [v.label, k as Weekday])
) as Record<string, Weekday>;

const LIFECYCLE_LABEL_TO_KEY: Record<string, LifecycleStage> = Object.fromEntries(
  Object.entries(LIFECYCLE_META).map(([k, v]) => [v.label, k as LifecycleStage])
) as Record<string, LifecycleStage>;

const COUPON_LABEL_TO_KEY: Record<string, CouponSensitivity> = Object.fromEntries(
  Object.entries(COUPON_META).map(([k, v]) => [v.label, k as CouponSensitivity])
) as Record<string, CouponSensitivity>;

const HOUR_LABEL_TO_KEY: Record<string, HourPref> = {
  "Madrugada (0-6h)": "madrugada",
  "Manha (6-12h)": "manha",
  "Tarde (12-18h)": "tarde",
  "Noite (18-24h)": "noite",
};

const DAYRANGE_LABEL_TO_KEY: Record<string, DayRange> = {
  "Dia 1-5": "1-5", "Dia 6-10": "6-10", "Dia 11-15": "11-15",
  "Dia 16-20": "16-20", "Dia 21-25": "21-25", "Dia 26-31": "26-31",
};

const SEGMENT_LABEL_TO_KEY: Record<string, RfmSegment> = Object.fromEntries(
  Object.entries(SEGMENT_META).map(([k, v]) => [v.label, k as RfmSegment])
) as Record<string, RfmSegment>;

// --- Badge components ---

function SegmentBadge({ segment }: { segment: RfmSegment }) {
  const meta = SEGMENT_META[segment];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ color: meta.color, backgroundColor: `${meta.color}15` }}
    >
      {meta.label}
    </span>
  );
}

function RfmScoreBadge({ score }: { score: string }) {
  const parts = score.split("-").map(Number);
  const colors = parts.map((p) =>
    p >= 4 ? "text-success" : p >= 3 ? "text-yellow-400" : "text-destructive"
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-mono font-semibold">
      <span className={colors[0]}>{parts[0]}</span>
      <span className="text-muted-foreground">-</span>
      <span className={colors[1]}>{parts[1]}</span>
      <span className="text-muted-foreground">-</span>
      <span className={colors[2]}>{parts[2]}</span>
    </span>
  );
}

function LifecycleBadge({ stage }: { stage: LifecycleStage }) {
  const meta = LIFECYCLE_META[stage];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ color: meta.color, backgroundColor: `${meta.color}15` }}
    >
      {meta.label}
    </span>
  );
}

// --- Chart wrapper for consistent loading/empty ---

function InfoTip({ children, side = "top" }: { children: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <UITooltip delayDuration={150}>
      <UITooltipTrigger asChild>
        <button type="button" className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground transition-colors" aria-label="Mais informações">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </UITooltipTrigger>
      <UITooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
        {children}
      </UITooltipContent>
    </UITooltip>
  );
}

type CohortMetric = "retention" | "ltv" | "revenue";

interface CohortHeatmapRow {
  monthKey: string;
  month: string;
  newClients: number;
  retentionCurve?: Array<{
    monthOffset: number;
    activePct: number;
    cumulativeLtv: number;
    monthRevenue: number;
  }>;
}

function CohortHeatmap({
  data, loading, metric, onMetricChange,
}: {
  data: CohortHeatmapRow[];
  loading: boolean;
  metric: CohortMetric;
  onMetricChange: (m: CohortMetric) => void;
}) {
  const valid = data.filter((r) => r.retentionCurve && r.retentionCurve.length > 0);
  // Reverse: safras mais recentes em cima
  const rows = [...valid].reverse();
  const maxOffset = Math.max(0, ...valid.map((r) => r.retentionCurve!.length - 1));

  // Pega valor da célula segundo a métrica selecionada
  const getValue = (row: CohortHeatmapRow, offset: number): number | null => {
    const entry = row.retentionCurve?.find((c) => c.monthOffset === offset);
    if (!entry) return null;
    if (metric === "retention") return entry.activePct;
    if (metric === "ltv") return entry.cumulativeLtv;
    return entry.monthRevenue;
  };

  // Computa max para escala de cor. Pra retention, ignora M+0 (sempre 100% — ruído).
  const allValues: number[] = [];
  for (const r of rows) {
    for (let o = metric === "retention" ? 1 : 0; o <= maxOffset; o++) {
      const v = getValue(r, o);
      if (v !== null && v > 0) allValues.push(v);
    }
  }
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 1;

  // Gradient: transparent → cor da métrica
  // retention=teal, ltv=indigo, revenue=amber
  const palette: Record<CohortMetric, { r: number; g: number; b: number }> = {
    retention: { r: 20, g: 184, b: 166 },  // teal-500
    ltv: { r: 99, g: 102, b: 241 },         // indigo-500
    revenue: { r: 245, g: 158, b: 11 },     // amber-500
  };

  const cellColor = (v: number | null, offset: number): string => {
    if (v === null) return "transparent";
    // M+0 retention sempre 100% — cor neutra
    if (metric === "retention" && offset === 0) return "rgba(100, 116, 139, 0.15)";
    const intensity = Math.min(1, v / maxVal);
    const { r, g, b } = palette[metric];
    return `rgba(${r}, ${g}, ${b}, ${0.08 + intensity * 0.75})`;
  };

  const fmt = (v: number | null): string => {
    if (v === null) return "";
    if (metric === "retention") return `${v.toFixed(1)}%`;
    if (metric === "ltv") return `R$${v.toFixed(0)}`;
    return `R$${(v / 1000).toFixed(1)}k`;
  };

  const subtitleByMetric: Record<CohortMetric, string> = {
    retention: "% de clientes da safra que comprou no mês decorrido. M+0 é sempre 100% (mês da aquisição). Quanto mais escuro à direita, melhor a retenção.",
    ltv: "Receita média por cliente acumulada da safra. Cresce ao longo do tempo. Compare safras: a Jun/25 tá mais escura à direita que Dez/25?",
    revenue: "Receita TOTAL que aquela safra gerou em cada mês decorrido. Útil pra entender padrões absolutos de spending por cohort.",
  };

  const metricLabels: Record<CohortMetric, string> = {
    retention: "% Retenção",
    ltv: "LTV Acumulado",
    revenue: "Receita do Mês",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-base">Cohort Heatmap</CardTitle>
              <InfoTip>
                <b>Linhas:</b> safras (mês da 1ª compra do cliente).<br/>
                <b>Colunas M+N:</b> meses decorridos desde a safra.<br/>
                <b>Células:</b> valor da métrica selecionada com cor de intensidade (escuro = melhor).<br/><br/>
                Compare safras lendo colunas: a safra de Jun/25 em M+6 vs Dez/25 em M+6 — qual reteve melhor?
              </InfoTip>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{subtitleByMetric[metric]}</p>
          </div>
          <div className="inline-flex rounded-md border border-border bg-card overflow-hidden shrink-0">
            {(Object.keys(metricLabels) as CohortMetric[]).map((m) => (
              <button
                key={m}
                onClick={() => onMetricChange(m)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  metric === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {metricLabels[m]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
        ) : (
          <table className="text-xs border-separate" style={{ borderSpacing: "2px" }}>
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2 px-2 text-left font-medium sticky left-0 bg-background z-10">Safra</th>
                <th className="py-2 px-2 text-right font-medium">Clientes</th>
                {Array.from({ length: maxOffset + 1 }, (_, i) => (
                  <th key={i} className="py-2 px-2 text-center font-medium min-w-[60px]">
                    M+{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.monthKey}>
                  <td className="py-1.5 px-2 font-medium whitespace-nowrap sticky left-0 bg-background z-10">{row.month}</td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">{formatNumber(row.newClients)}</td>
                  {Array.from({ length: maxOffset + 1 }, (_, offset) => {
                    const v = getValue(row, offset);
                    return (
                      <td
                        key={offset}
                        className="text-center px-2 py-1.5 rounded transition-colors"
                        style={{
                          backgroundColor: cellColor(v, offset),
                          color: v !== null && v > maxVal * 0.55 ? "white" : undefined,
                          fontWeight: v !== null && v > maxVal * 0.55 ? 600 : 400,
                        }}
                        title={v !== null ? `${row.month} → M+${offset}: ${fmt(v)}` : ""}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title, subtitle, info, loading, isEmpty, height = 250, children, actions,
}: {
  title: string; subtitle?: string; info?: React.ReactNode;
  loading: boolean; isEmpty: boolean; height?: number;
  children: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-base">{title}</CardTitle>
              {info && <InfoTip>{info}</InfoTip>}
            </div>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          {!loading && !isEmpty && actions}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
            Sem dados
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

// --- CSV export ---

const HOUR_LABELS: Record<HourPref, string> = {
  madrugada: "Madrugada (0-6h)", manha: "Manha (6-12h)",
  tarde: "Tarde (12-18h)", noite: "Noite (18-24h)",
};

const DOW_LABELS: Record<DayOfWeekPref, string> = {
  weekday: "Dia de semana", weekend: "Fim de semana",
};

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportCustomersCsv(list: RfmCustomer[], filename: string) {
  if (list.length === 0) return;

  const headers = [
    "Nome", "Email", "Telefone", "Total Compras", "Total Gasto", "Ticket Medio",
    "Primeira Compra", "Ultima Compra", "Dias sem Comprar",
    "Score R", "Score F", "Score M", "Score RFM",
    "Segmento", "Faixa Dia Mes", "Dia Semana Pref", "Dia Semana",
    "Turno", "Sensibilidade Cupom", "Lifecycle", "Cupons Usados",
  ];

  const rows = list.map((c) => [
    escapeCsvField(c.name),
    escapeCsvField(c.email),
    escapeCsvField(c.phone),
    String(c.totalPurchases),
    c.totalSpent.toFixed(2),
    c.avgTicket.toFixed(2),
    c.firstPurchaseDate,
    c.lastPurchaseDate,
    c.daysSinceLastPurchase >= 9999 ? "" : String(c.daysSinceLastPurchase),
    String(c.recencyScore),
    String(c.frequencyScore),
    String(c.monetaryScore),
    c.rfmScore,
    SEGMENT_META[c.segment].label,
    `Dia ${c.preferredDayRange}`,
    DOW_LABELS[c.preferredDayOfWeek],
    WEEKDAY_META[c.preferredWeekday].label,
    HOUR_LABELS[c.preferredHour],
    COUPON_META[c.couponSensitivity].label,
    LIFECYCLE_META[c.lifecycleStage].label,
    escapeCsvField(c.couponsUsed.join("; ")),
  ].join(","));

  const bom = "\uFEFF";
  const csv = bom + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Advanced filter popovers ---

function DateRangeFilterPopover({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { from: string; to: string } | null;
  onChange: (v: { from: string; to: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DateRange | undefined>(
    value ? { from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") } : undefined
  );
  const isActive = value !== null;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const displayLabel = isActive
    ? `${format(new Date(value!.from + "T00:00:00"), "dd MMM", { locale: ptBR })} - ${format(new Date(value!.to + "T00:00:00"), "dd MMM yy", { locale: ptBR })}`
    : label;

  const pendingLabel = pending?.from
    ? pending.to
      ? `${format(pending.from, "dd MMM yyyy", { locale: ptBR })} - ${format(pending.to, "dd MMM yyyy", { locale: ptBR })}`
      : `${format(pending.from, "dd MMM yyyy", { locale: ptBR })} - ...`
    : null;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o && value) setPending({ from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") }); }}>
      <PopoverTrigger asChild>
        <button className={`flex items-center gap-1.5 h-10 rounded-md border px-3 text-sm text-foreground whitespace-nowrap hover:bg-accent/50 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
          <CalendarIcon className="h-3.5 w-3.5 opacity-60 shrink-0" />
          {displayLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs font-medium text-foreground">{label}</span>
            {pendingLabel && <span className="text-xs text-muted-foreground">{pendingLabel}</span>}
          </div>
          <Calendar
            mode="range"
            selected={pending}
            onSelect={setPending}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
            defaultMonth={pending?.from || new Date()}
          />
          <div className="flex justify-between px-4 pb-3 pt-1 gap-2">
            <button onClick={() => { onChange(null); setPending(undefined); setOpen(false); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Limpar
            </button>
            <button
              onClick={() => { if (pending?.from && pending?.to) { onChange({ from: fmt(pending.from), to: fmt(pending.to) }); setOpen(false); } }}
              disabled={!(pending?.from && pending?.to)}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${pending?.from && pending?.to ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
            >
              Aplicar
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NumericRangeFilterPopover({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { min: number | null; max: number | null };
  onChange: (v: { min: number | null; max: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localMin, setLocalMin] = useState(value.min !== null ? String(value.min) : "");
  const [localMax, setLocalMax] = useState(value.max !== null ? String(value.max) : "");
  const isActive = value.min !== null || value.max !== null;

  const handleOpen = (o: boolean) => {
    setOpen(o);
    if (o) {
      setLocalMin(value.min !== null ? String(value.min) : "");
      setLocalMax(value.max !== null ? String(value.max) : "");
    }
  };

  const displayLabel = isActive
    ? `${label}: ${value.min !== null ? `R$${value.min}` : ""}${value.min !== null && value.max !== null ? " - " : ""}${value.max !== null ? `R$${value.max}` : value.min !== null ? "+" : ""}`
    : label;

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className={`flex items-center gap-1.5 h-10 rounded-md border px-3 text-sm text-foreground whitespace-nowrap hover:bg-accent/50 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
          <SlidersHorizontal className="h-3.5 w-3.5 opacity-60 shrink-0" />
          {displayLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="start">
        <p className="text-sm font-medium mb-3">{label}</p>
        <div className="flex gap-2 items-center">
          <input type="number" placeholder="Min" value={localMin} onChange={(e) => setLocalMin(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <span className="text-muted-foreground text-xs shrink-0">-</span>
          <input type="number" placeholder="Max" value={localMax} onChange={(e) => setLocalMax(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex justify-between mt-3">
          <button onClick={() => { onChange({ min: null, max: null }); setLocalMin(""); setLocalMax(""); setOpen(false); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Limpar
          </button>
          <button
            onClick={() => { onChange({ min: localMin !== "" ? Number(localMin) : null, max: localMax !== "" ? Number(localMax) : null }); setOpen(false); }}
            className="px-4 py-1.5 text-sm rounded-md font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Aplicar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Page ---

export default function CrmPage() {
  const { workspace } = useWorkspace();
  const chart = useChartTheme();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // "Inverter": quando true, mostra a base EXCETO o que os filtros pegam.
  // Reset automático quando os filtros são todos limpos.
  const [invertFilters, setInvertFilters] = useState(false);
  const searchTimerRef = useRef<NodeJS.Timeout>(undefined);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 500);
  }, []);
  const [segmentFilter, setSegmentFilter] = useState<RfmSegment | "all">("all");
  const [dayRangeFilter, setDayRangeFilter] = useState<DayRange | "all">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | "all">("all");
  const [hourFilter, setHourFilter] = useState<HourPref | "all">("all");
  const [couponFilter, setCouponFilter] = useState<CouponSensitivity | "all">("all");
  const [weekdayFilter, setWeekdayFilter] = useState<Weekday | "all">("all");
  // Filtro composto por UF do último pedido (multi-select). customerStates
  // é o lookup email → UF carregado em paralelo com customers (snapshot
  // ainda não carrega state — vide /api/crm/customer-states).
  const [stateFilter, setStateFilter] = useState<Set<UF>>(new Set());
  const [customerStates, setCustomerStates] = useState<Record<string, string>>({});
  const [stateTilemapOpen, setStateTilemapOpen] = useState(false);
  const [purchasedDateRange, setPurchasedDateRange] = useState<{ from: string; to: string } | null>(null);
  const [inactiveDateRange, setInactiveDateRange] = useState<{ from: string; to: string } | null>(null);
  const [avgTicketRange, setAvgTicketRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [totalSpentRange, setTotalSpentRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [activeTab, setActiveTab] = useState("metrics");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [cooldownDays, setCooldownDays] = useState(7);

  // Campaign dialog
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [campaignContacts, setCampaignContacts] = useState<Array<{ name: string; email: string; phone: string }>>([]);
  const [campaignSuggestedName, setCampaignSuggestedName] = useState<string | undefined>();
  const [pendingCampaign, setPendingCampaign] = useState<{ name: string; filters: CrmFilters } | null>(null);

  // Email-list dialog (Locaweb)
  const [emailListDialogOpen, setEmailListDialogOpen] = useState(false);
  const [emailListContacts, setEmailListContacts] = useState<Array<{ email: string; name: string }>>([]);
  const [emailListSuggestedName, setEmailListSuggestedName] = useState<string | undefined>();

  // Customer row selection
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());

  const [customers, setCustomers] = useState<RfmCustomer[]>([]);
  const [segments, setSegments] = useState<RfmSegmentSummary[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [distributions, setDistributions] = useState(emptyDistributions);
  const [behavioral, setBehavioral] = useState(emptyBehavioral);

  // Metrics tab
  interface MetricsData {
    arpu: number;
    avgOrdersPerClient: number;
    repurchaseRate: number;
    newClients: number;
    totalClients: number;
    totalRevenue: number;
  }
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyCohortRow[]>([]);
  const [adSpend, setAdSpend] = useState<Record<string, number> | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsPeriod, setMetricsPeriod] = useState(12);
  const [cohortMetric, setCohortMetric] = useState<"retention" | "ltv" | "revenue">("retention");
  const [financialSettings, setFinancialSettings] = useState<{
    product_cost_pct: number; tax_pct: number; frete_pct: number;
    desconto_pct: number; other_expenses_pct: number; invest_pct: number;
  } | null>(null);

  // Snapshot recompute
  const [computing, setComputing] = useState(false);

  // VNDA order sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Export logs
  interface ExportLog {
    id: string;
    export_type: string;
    filters: Record<string, string> | null;
    record_count: number;
    created_at: string;
  }
  const [exportLogs, setExportLogs] = useState<ExportLog[]>([]);

  const wsHeaders = useCallback((): Record<string, string> => {
    const hdrs: Record<string, string> = {};
    if (workspace?.id) hdrs["x-workspace-id"] = workspace.id;
    return hdrs;
  }, [workspace?.id]);

  // Stage 1: summary only (mount) — ~5KB instead of 10-35MB
  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/rfm?fields=summary", { headers: wsHeaders() });
      const data = await res.json();

      // If snapshot is missing but data exists, auto-trigger compute and poll
      if (data.pending) {
        setComputing(true);
        const compRes = await fetch("/api/crm/compute", {
          method: "POST",
          headers: wsHeaders(),
        });
        if (compRes.ok) {
          // Snapshot ready — re-fetch summary
          const res2 = await fetch("/api/crm/rfm?fields=summary", { headers: wsHeaders() });
          const data2 = await res2.json();
          setSegments(data2.segments || []);
          setSummary(data2.summary || emptySummary);
          setDistributions(data2.distributions || emptyDistributions);
          setBehavioral(data2.behavioralDistributions || emptyBehavioral);
        }
        setComputing(false);
        return;
      }

      setSegments(data.segments || []);
      setSummary(data.summary || emptySummary);
      setDistributions(data.distributions || emptyDistributions);
      setBehavioral(data.behavioralDistributions || emptyBehavioral);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [wsHeaders]);

  // Stage 2: full customers (lazy, on Clientes tab)
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);

  const fetchCustomers = useCallback(async () => {
    if (customersLoaded) return;
    setCustomersLoading(true);
    try {
      // Em paralelo: snapshot completo + lookup email→UF (separado pq o
      // snapshot ainda não carrega state).
      const [resCustomers, resStates] = await Promise.all([
        fetch("/api/crm/rfm", { headers: wsHeaders() }),
        fetch("/api/crm/customer-states", { headers: wsHeaders() }),
      ]);
      const data = await resCustomers.json();
      setCustomers(data.customers || []);
      if (resStates.ok) {
        const sd = await resStates.json();
        setCustomerStates(sd.map || {});
      }
      setCustomersLoaded(true);
    } catch {
      // Keep empty state
    } finally {
      setCustomersLoading(false);
    }
  }, [wsHeaders, customersLoaded]);

  // Same as fetchCustomers, but returns the list — used by the action bar
  // buttons that fire from the Métricas tab BEFORE the Clientes tab triggers
  // the lazy load.
  const ensureCustomersLoaded = useCallback(async (): Promise<RfmCustomer[]> => {
    if (customersLoaded) return customers;
    setCustomersLoading(true);
    try {
      const res = await fetch("/api/crm/rfm", { headers: wsHeaders() });
      const data = await res.json();
      const list: RfmCustomer[] = data.customers || [];
      setCustomers(list);
      setCustomersLoaded(true);
      return list;
    } catch {
      return [];
    } finally {
      setCustomersLoading(false);
    }
  }, [wsHeaders, customersLoaded, customers]);

  const fetchExportLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/export-logs", { headers: wsHeaders() });
      if (res.ok) {
        const data = await res.json();
        setExportLogs(data.logs || []);
      }
    } catch {
      // Silent — non-critical
    }
  }, [wsHeaders]);

  // Agent panel → apply suggested filters
  const handleAgentApplyFilters = useCallback((filters: CrmFilters) => {
    setSegmentFilter(filters.segmentFilter);
    setDayRangeFilter(filters.dayRangeFilter);
    setLifecycleFilter(filters.lifecycleFilter);
    setHourFilter(filters.hourFilter);
    setCouponFilter(filters.couponFilter);
    setWeekdayFilter(filters.weekdayFilter);
    setActiveTab("customers");
    if (!customersLoaded) fetchCustomers();
  }, [customersLoaded, fetchCustomers]);

  // Agent panel → create campaign from suggestion
  const handleAgentCreateCampaign = useCallback((name: string, filters: CrmFilters) => {
    setSegmentFilter(filters.segmentFilter);
    setDayRangeFilter(filters.dayRangeFilter);
    setLifecycleFilter(filters.lifecycleFilter);
    setHourFilter(filters.hourFilter);
    setCouponFilter(filters.couponFilter);
    setWeekdayFilter(filters.weekdayFilter);
    setActiveTab("customers");
    if (!customersLoaded) fetchCustomers();
    // Store pending — useEffect will open dialog once customers are loaded
    setPendingCampaign({ name, filters });
  }, [customersLoaded, fetchCustomers]);

  // Open campaign dialog once customers are ready (resolves race condition)
  useEffect(() => {
    if (!pendingCampaign || !customersLoaded) return;
    const { name, filters } = pendingCampaign;
    const filtered = customers.filter((c) => {
      if (filters.segmentFilter !== "all" && c.segment !== filters.segmentFilter) return false;
      if (filters.dayRangeFilter !== "all" && c.preferredDayRange !== filters.dayRangeFilter) return false;
      if (filters.lifecycleFilter !== "all" && c.lifecycleStage !== filters.lifecycleFilter) return false;
      if (filters.hourFilter !== "all" && c.preferredHour !== filters.hourFilter) return false;
      if (filters.couponFilter !== "all" && c.couponSensitivity !== filters.couponFilter) return false;
      if (filters.weekdayFilter !== "all" && c.preferredWeekday !== filters.weekdayFilter) return false;
      return true;
    }).map((c) => ({ name: c.name, email: c.email, phone: c.phone }));
    setCampaignContacts(filtered);
    setCampaignSuggestedName(name);
    setCampaignDialogOpen(true);
    setPendingCampaign(null);
  }, [pendingCampaign, customersLoaded, customers]);

  // Fire-and-forget export log
  const logExport = useCallback(
    (exportType: string, filters: Record<string, string>, recordCount: number) => {
      fetch("/api/crm/export-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...wsHeaders() },
        body: JSON.stringify({ export_type: exportType, filters, record_count: recordCount }),
      })
        .then(() => fetchExportLogs())
        .catch(() => {});
    },
    [wsHeaders, fetchExportLogs]
  );

  const fetchMetrics = useCallback(async (opts?: { bypassCache?: boolean }) => {
    setMetricsLoading(true);
    try {
      const fetchInit: RequestInit = opts?.bypassCache
        ? { headers: wsHeaders(), cache: "reload" }
        : { headers: wsHeaders() };
      const [cohortRes, finRes] = await Promise.all([
        fetch(`/api/crm/cohort?months=${metricsPeriod}`, fetchInit),
        fetch("/api/financial-settings", { headers: wsHeaders() }),
      ]);
      const cohort = await cohortRes.json();
      const fin = await finRes.json();

      setMetricsData(cohort.metrics || null);
      setMonthlyData(cohort.monthlyData || []);
      setAdSpend(cohort.adSpend || null);
      setFinancialSettings({
        product_cost_pct: fin.product_cost_pct ?? 25,
        tax_pct: fin.tax_pct ?? 6,
        frete_pct: fin.frete_pct ?? 6,
        desconto_pct: fin.desconto_pct ?? 3,
        other_expenses_pct: fin.other_expenses_pct ?? 5,
        invest_pct: fin.invest_pct ?? 12,
      });
    } catch {
      // Keep empty
    } finally {
      setMetricsLoading(false);
    }
  }, [wsHeaders, metricsPeriod]);

  // Recompute RFM snapshot
  const handleRecompute = useCallback(async () => {
    setComputing(true);
    try {
      const res = await fetch("/api/crm/compute", {
        method: "POST",
        headers: wsHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[CRM] Recompute failed:", data.error);
      } else {
        // Reload all data from the fresh snapshot. bypassCache: true
        // pra ignorar Cache-Control: max-age=300 do /api/crm/cohort que
        // de outro modo serviria o response antigo sem retentionCurve etc.
        setCustomersLoaded(false);
        await Promise.all([fetchSummary(), fetchMetrics({ bypassCache: true }), fetchExportLogs()]);
      }
    } catch (err) {
      console.error("[CRM] Recompute error:", err);
    } finally {
      setComputing(false);
    }
  }, [wsHeaders, fetchSummary, fetchMetrics, fetchExportLogs]);

  // Sync orders from VNDA API (backfill)
  const handleVndaSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/crm/vnda-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...wsHeaders() },
        body: JSON.stringify({ startDate: "2020-01-01" }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`✓ ${data.synced} pedidos sincronizados`);
        setCustomersLoaded(false);
        await Promise.all([fetchSummary(), fetchMetrics({ bypassCache: true }), fetchExportLogs()]);
      } else {
        setSyncResult(`Erro: ${data.error}`);
      }
    } catch (err) {
      console.error("[CRM] Sync error:", err);
      setSyncResult("Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }, [wsHeaders, fetchSummary, fetchMetrics, fetchExportLogs]);

  // Stage 1: mount — summary + metrics (light payloads)
  useEffect(() => {
    fetchSummary();
    fetchMetrics();
    fetchExportLogs();
  }, [fetchSummary, fetchMetrics, fetchExportLogs]);

  // Stage 2: lazy-load customers when Clientes tab is activated
  useEffect(() => {
    if (activeTab === "customers" && !customersLoaded) {
      fetchCustomers();
    }
  }, [activeTab, customersLoaded, fetchCustomers]);

  // Filtered customers — single-pass for performance (avoids 12+ intermediate arrays).
  // Quando invertFilters=true, retorna a base EXCETO o que os filtros pegariam
  // (mas o search e filtros de range continuam sempre incluídos, sem inversão).
  const filteredCustomers = useMemo(() => {
    const q = debouncedSearch ? debouncedSearch.toLowerCase() : "";
    return customers.filter((c) => {
      // Search e ranges — sempre aplicam (não invertem).
      if (q && !c.name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
      if (purchasedDateRange && (c.lastPurchaseDate < purchasedDateRange.from || c.firstPurchaseDate > purchasedDateRange.to)) return false;
      if (inactiveDateRange && c.lastPurchaseDate >= inactiveDateRange.from) return false;
      if (avgTicketRange.min !== null && c.avgTicket < avgTicketRange.min) return false;
      if (avgTicketRange.max !== null && c.avgTicket > avgTicketRange.max) return false;
      if (totalSpentRange.min !== null && c.totalSpent < totalSpentRange.min) return false;
      if (totalSpentRange.max !== null && c.totalSpent > totalSpentRange.max) return false;

      // Filtros de segmentação/comportamento — combinam com AND, e
      // podem ser invertidos pelo botão "Inverter".
      const matchesSegment = segmentFilter === "all" || c.segment === segmentFilter;
      const matchesDay = dayRangeFilter === "all" || c.preferredDayRange === dayRangeFilter;
      const matchesLifecycle = lifecycleFilter === "all" || c.lifecycleStage === lifecycleFilter;
      const matchesHour = hourFilter === "all" || c.preferredHour === hourFilter;
      const matchesCoupon = couponFilter === "all" || c.couponSensitivity === couponFilter;
      const matchesWeekday = weekdayFilter === "all" || c.preferredWeekday === weekdayFilter;
      // UF do último pedido — prefere c.state (snapshot novo), cai pro
      // customerStates lookup (snapshots antigos). Cliente sem estado
      // conhecido é excluído quando há filtro ativo.
      const uf = (c.state ?? customerStates[c.email] ?? "") as UF;
      const matchesState = stateFilter.size === 0 || stateFilter.has(uf);
      const hasAnyFilter = segmentFilter !== "all" || dayRangeFilter !== "all" || lifecycleFilter !== "all" || hourFilter !== "all" || couponFilter !== "all" || weekdayFilter !== "all" || stateFilter.size > 0;

      const matches = matchesSegment && matchesDay && matchesLifecycle && matchesHour && matchesCoupon && matchesWeekday && matchesState;
      return invertFilters && hasAnyFilter ? !matches : matches;
    });
  }, [customers, segmentFilter, dayRangeFilter, lifecycleFilter, hourFilter, couponFilter, weekdayFilter, stateFilter, customerStates, purchasedDateRange, inactiveDateRange, avgTicketRange, totalSpentRange, debouncedSearch, invertFilters]);


  const handleRowSelect = useCallback((row: Record<string, unknown>) => {
    const email = String(row.email || "");
    if (!email) return;
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  // Selected customers for campaign
  const selectedCustomers = useMemo(() =>
    filteredCustomers.filter((c) => selectedEmails.has(c.email)),
    [filteredCustomers, selectedEmails]
  );

  // Active filters for badge bar
  interface ActiveFilter {
    type: string;
    value: string;
    label: string;
    color: string;
    onRemove: () => void;
  }

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (segmentFilter !== "all") {
      const meta = SEGMENT_META[segmentFilter];
      filters.push({ type: "segment", value: segmentFilter, label: meta.label, color: meta.color, onRemove: () => setSegmentFilter("all") });
    }
    if (dayRangeFilter !== "all") {
      filters.push({ type: "dayRange", value: dayRangeFilter, label: `Dia ${dayRangeFilter}`, color: "#3b82f6", onRemove: () => setDayRangeFilter("all") });
    }
    if (lifecycleFilter !== "all") {
      const meta = LIFECYCLE_META[lifecycleFilter];
      filters.push({ type: "lifecycle", value: lifecycleFilter, label: meta.label, color: meta.color, onRemove: () => setLifecycleFilter("all") });
    }
    if (hourFilter !== "all") {
      filters.push({ type: "hour", value: hourFilter, label: HOUR_LABELS[hourFilter], color: "#f59e0b", onRemove: () => setHourFilter("all") });
    }
    if (couponFilter !== "all") {
      const meta = COUPON_META[couponFilter];
      filters.push({ type: "coupon", value: couponFilter, label: meta.label, color: meta.color, onRemove: () => setCouponFilter("all") });
    }
    if (weekdayFilter !== "all") {
      const meta = WEEKDAY_META[weekdayFilter];
      filters.push({ type: "weekday", value: weekdayFilter, label: meta.label, color: meta.color, onRemove: () => setWeekdayFilter("all") });
    }
    if (purchasedDateRange) {
      const f = format(new Date(purchasedDateRange.from + "T00:00:00"), "dd MMM yy", { locale: ptBR });
      const t = format(new Date(purchasedDateRange.to + "T00:00:00"), "dd MMM yy", { locale: ptBR });
      filters.push({ type: "purchasedDate", value: `${purchasedDateRange.from}_${purchasedDateRange.to}`, label: `Comprou: ${f} - ${t}`, color: "#10b981", onRemove: () => setPurchasedDateRange(null) });
    }
    if (inactiveDateRange) {
      const f = format(new Date(inactiveDateRange.from + "T00:00:00"), "dd MMM yy", { locale: ptBR });
      const t = format(new Date(inactiveDateRange.to + "T00:00:00"), "dd MMM yy", { locale: ptBR });
      filters.push({ type: "inactiveDate", value: `${inactiveDateRange.from}_${inactiveDateRange.to}`, label: `Inativo: ${f} - ${t}`, color: "#ef4444", onRemove: () => setInactiveDateRange(null) });
    }
    if (avgTicketRange.min !== null || avgTicketRange.max !== null) {
      const parts: string[] = [];
      if (avgTicketRange.min !== null) parts.push(`min R$${avgTicketRange.min}`);
      if (avgTicketRange.max !== null) parts.push(`max R$${avgTicketRange.max}`);
      filters.push({ type: "avgTicket", value: `${avgTicketRange.min ?? ""}-${avgTicketRange.max ?? ""}`, label: `Ticket: ${parts.join(" - ")}`, color: "#8b5cf6", onRemove: () => setAvgTicketRange({ min: null, max: null }) });
    }
    if (totalSpentRange.min !== null || totalSpentRange.max !== null) {
      const parts: string[] = [];
      if (totalSpentRange.min !== null) parts.push(`min R$${totalSpentRange.min}`);
      if (totalSpentRange.max !== null) parts.push(`max R$${totalSpentRange.max}`);
      filters.push({ type: "totalSpent", value: `${totalSpentRange.min ?? ""}-${totalSpentRange.max ?? ""}`, label: `Total: ${parts.join(" - ")}`, color: "#06b6d4", onRemove: () => setTotalSpentRange({ min: null, max: null }) });
    }
    return filters;
  }, [segmentFilter, dayRangeFilter, lifecycleFilter, hourFilter, couponFilter, weekdayFilter, purchasedDateRange, inactiveDateRange, avgTicketRange, totalSpentRange]);

  // Auto-load customers when any filter is applied
  useEffect(() => {
    if (!customersLoaded && activeFilters.length > 0) {
      fetchCustomers();
    }
  }, [customersLoaded, activeFilters.length, fetchCustomers]);

  const clearAllFilters = useCallback(() => {
    setSelectedEmails(new Set());
    setSegmentFilter("all");
    setDayRangeFilter("all");
    setLifecycleFilter("all");
    setHourFilter("all");
    setCouponFilter("all");
    setWeekdayFilter("all");
    setPurchasedDateRange(null);
    setInactiveDateRange(null);
    setAvgTicketRange({ min: null, max: null });
    setTotalSpentRange({ min: null, max: null });
    setInvertFilters(false);
  }, []);

  const handleGlobalExport = useCallback(() => {
    const filters: Record<string, string> = {};
    const parts: string[] = [];
    if (segmentFilter !== "all") { parts.push(SEGMENT_META[segmentFilter].label); filters.segmento = segmentFilter; }
    if (dayRangeFilter !== "all") { parts.push(`dia-${dayRangeFilter}`); filters.faixa_dia = dayRangeFilter; }
    if (lifecycleFilter !== "all") { parts.push(LIFECYCLE_META[lifecycleFilter].label); filters.lifecycle = lifecycleFilter; }
    if (hourFilter !== "all") { parts.push(HOUR_LABELS[hourFilter]); filters.turno = hourFilter; }
    if (couponFilter !== "all") { parts.push(COUPON_META[couponFilter].label); filters.cupom = couponFilter; }
    if (weekdayFilter !== "all") { parts.push(WEEKDAY_META[weekdayFilter].label); filters.dia_semana = weekdayFilter; }
    if (purchasedDateRange) { parts.push(`comprou-${purchasedDateRange.from}-${purchasedDateRange.to}`); filters.comprou_periodo = `${purchasedDateRange.from}_${purchasedDateRange.to}`; }
    if (inactiveDateRange) { parts.push(`inativo-${inactiveDateRange.from}-${inactiveDateRange.to}`); filters.inativo_periodo = `${inactiveDateRange.from}_${inactiveDateRange.to}`; }
    if (avgTicketRange.min !== null || avgTicketRange.max !== null) { parts.push(`ticket-${avgTicketRange.min ?? 0}-${avgTicketRange.max ?? "max"}`); filters.ticket_medio = `${avgTicketRange.min ?? ""}-${avgTicketRange.max ?? ""}`; }
    if (totalSpentRange.min !== null || totalSpentRange.max !== null) { parts.push(`total-${totalSpentRange.min ?? 0}-${totalSpentRange.max ?? "max"}`); filters.compra_acumulada = `${totalSpentRange.min ?? ""}-${totalSpentRange.max ?? ""}`; }
    if (debouncedSearch) filters.busca = debouncedSearch;
    const suffix = parts.length > 0
      ? parts.join("-").toLowerCase().replace(/[\s()]+/g, "").replace(/-+/g, "-")
      : "todos";
    exportCustomersCsv(filteredCustomers, `crm-clientes-${suffix}`);
    logExport("hypersegmentation", filters, filteredCustomers.length);
  }, [segmentFilter, dayRangeFilter, lifecycleFilter, hourFilter, couponFilter, weekdayFilter, purchasedDateRange, inactiveDateRange, avgTicketRange, totalSpentRange, debouncedSearch, filteredCustomers, logExport]);

  // KPI values — recalculate from filtered list when filters are active
  const hasActiveFilters = activeFilters.length > 0 || debouncedSearch.length > 0;
  const displaySummary = useMemo(() => {
    if (!hasActiveFilters) return summary;
    const list = filteredCustomers;
    const totalRevenue = list.reduce((s, c) => s + c.totalSpent, 0);
    const activeCustomers = list.filter((c) => c.daysSinceLastPurchase <= 90).length;
    return {
      totalCustomers: list.length,
      totalRevenue,
      avgTicket: list.length > 0 ? totalRevenue / list.reduce((s, c) => s + c.totalPurchases, 0) : 0,
      activeCustomers,
      avgPurchasesPerCustomer: summary.avgPurchasesPerCustomer,
      medianRecency: summary.medianRecency,
    };
  }, [hasActiveFilters, filteredCustomers, summary]);

  // Pie chart data
  const segmentPieData = useMemo(() => {
    return segments.filter((s) => s.customerCount > 0).map((s) => ({
      name: s.label, value: s.customerCount, color: s.color,
    }));
  }, [segments]);

  // Revenue by segment bar chart
  const revenueBySegmentData = useMemo(() => {
    return [...segments].filter((s) => s.totalRevenue > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map((s) => ({ name: s.label, revenue: s.totalRevenue, color: s.color }));
  }, [segments]);

  // Chart click handlers (toggle filter on/off)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ChartClickData = any;

  const handleSegmentClick = (segment: RfmSegment) => {
    setSegmentFilter((prev) => (prev === segment ? "all" : segment));
  };

  const handleSegmentChartClick = useCallback((data: ChartClickData) => {
    const name = data?.name ?? data?.payload?.name;
    const key = name ? SEGMENT_LABEL_TO_KEY[name] : undefined;
    if (key) setSegmentFilter((prev) => (prev === key ? "all" : key));
  }, []);

  const handleDayOfMonthClick = useCallback((data: ChartClickData) => {
    const bucket = data?.bucket ?? data?.payload?.bucket;
    const key = bucket ? DAYRANGE_LABEL_TO_KEY[bucket] : undefined;
    if (key) setDayRangeFilter((prev) => (prev === key ? "all" : key));
  }, []);

  const handleHourClick = useCallback((data: ChartClickData) => {
    const bucket = data?.bucket ?? data?.payload?.bucket;
    const key = bucket ? HOUR_LABEL_TO_KEY[bucket] : undefined;
    if (key) setHourFilter((prev) => (prev === key ? "all" : key));
  }, []);

  const handleCouponClick = useCallback((data: ChartClickData) => {
    const bucket = data?.bucket ?? data?.payload?.bucket;
    const key = bucket ? COUPON_LABEL_TO_KEY[bucket] : undefined;
    if (key) setCouponFilter((prev) => (prev === key ? "all" : key));
  }, []);

  const handleLifecycleClick = useCallback((data: ChartClickData) => {
    const bucket = data?.bucket ?? data?.payload?.bucket;
    const key = bucket ? LIFECYCLE_LABEL_TO_KEY[bucket] : undefined;
    if (key) setLifecycleFilter((prev) => (prev === key ? "all" : key));
  }, []);

  const handleWeekdayClick = useCallback((data: ChartClickData) => {
    const bucket = data?.bucket ?? data?.payload?.bucket;
    const key = bucket ? WEEKDAY_LABEL_TO_KEY[bucket] : undefined;
    if (key) setWeekdayFilter((prev) => (prev === key ? "all" : key));
  }, []);

  // Computed metrics for Metricas tab
  const mcPct = useMemo(() => {
    if (!financialSettings) return 43; // default with invest
    return 100 - financialSettings.product_cost_pct - financialSettings.tax_pct
      - financialSettings.frete_pct - financialSettings.desconto_pct
      - financialSettings.other_expenses_pct - financialSettings.invest_pct;
  }, [financialSettings]);

  // CMV (COGS) como % da receita — apenas o custo do produto vendido
  // (definição contábil brasileira estrita). Frete/impostos/descontos
  // são despesas variáveis, não entram em CMV. Default 25%.
  const cogsPct = useMemo(() => {
    return (financialSettings?.product_cost_pct ?? 25) / 100;
  }, [financialSettings]);

  // Monthly data with CAC + MEL computed (per-month: spend do mês / novos do mês)
  const monthlyWithCac = useMemo(() => {
    return monthlyData.map((m) => {
      const spend = adSpend?.[m.monthKey] ?? null;
      const cac = spend !== null && m.newClients > 0 ? spend / m.newClients : null;
      // MEL por safra = LTV lifetime da safra ÷ (CAC + COGS total da safra/cliente)
      // COGS por cliente = LTV bruto × cogsPct (% padrão de financial-settings)
      const ltvSafra = m.newClients > 0 ? m.cohortLifetimeRevenue / m.newClients : 0;
      const cogsPorCliente = ltvSafra * cogsPct;
      const mel = cac !== null && cac > 0 && ltvSafra > 0
        ? ltvSafra / (cac + cogsPorCliente)
        : null;
      return { ...m, adSpend: spend, cac, mel };
    });
  }, [monthlyData, adSpend, cogsPct]);

  // Period totals — derived from monthlyWithCac (visible period only).
  // CRÍTICO: usar isso para CAC/Clientes Novos pra evitar inconsistência
  // com o snapshot.metrics, que pode ter newClients lifetime (todo histórico).
  const periodTotals = useMemo(() => {
    const newClients = monthlyWithCac.reduce((s, m) => s + m.newClients, 0);
    const totalSpend = monthlyWithCac.reduce((s, m) => s + (m.adSpend ?? 0), 0);
    const totalRevenue = monthlyWithCac.reduce((s, m) => s + m.totalRevenue, 0);
    const cohortLifetimeRevenue = monthlyWithCac.reduce((s, m) => s + (m.cohortLifetimeRevenue ?? 0), 0);
    const hasSpendData = monthlyWithCac.some((m) => m.adSpend !== null);
    const cac = hasSpendData && newClients > 0 ? totalSpend / newClients : null;
    const ltvCohort = newClients > 0 ? cohortLifetimeRevenue / newClients : 0;
    // MEL agregado: LTV cohort ÷ (CAC + COGS por cliente)
    const cogsPorCliente = ltvCohort * cogsPct;
    const mel = cac !== null && cac > 0 && ltvCohort > 0
      ? ltvCohort / (cac + cogsPorCliente)
      : null;
    return { newClients, totalSpend, totalRevenue, cohortLifetimeRevenue, cac, ltvCohort, mel, cogsPorCliente };
  }, [monthlyWithCac, cogsPct]);

  const cacMedio = periodTotals.cac;
  const totalAdSpend = periodTotals.totalSpend > 0 ? periodTotals.totalSpend : null;

  // LTV ARPU-based (mantém pra retrocompatibilidade da UI antiga)
  const ltv = useMemo(() => {
    if (!metricsData) return 0;
    return metricsData.arpu * (mcPct / 100);
  }, [metricsData, mcPct]);

  // LTV cohort com margem aplicada (mais correto pra comparar com CAC)
  const ltvCohortMargin = useMemo(() => {
    return periodTotals.ltvCohort * (mcPct / 100);
  }, [periodTotals.ltvCohort, mcPct]);

  // Recomendação automática (Escalar / Manter / Cortar) — regras
  // determinísticas combinando MEL agregado + trend CAC + trend recompra.
  // Sem LLM: rápido, transparente, replicável.
  const melRecommendation = useMemo((): {
    action: "escalar" | "manter" | "cortar";
    label: string;
    color: string;
    summary: string;
    reasons: string[];
    cautions: string[];
  } | null => {
    if (!periodTotals.mel || monthlyWithCac.length < 4) return null;

    // Split: 3 meses recentes vs 3 anteriores (precisa de >=6 meses úteis com dados)
    const withCac = monthlyWithCac.filter((m) => m.cac !== null && m.cac > 0);
    if (withCac.length < 4) return null;

    const recent = withCac.slice(-3);
    const older = withCac.slice(-6, -3);
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

    const recentCac = avg(recent.map((m) => m.cac!));
    const olderCac = older.length > 0 ? avg(older.map((m) => m.cac!)) : recentCac;
    const cacTrendPct = olderCac > 0 ? ((recentCac - olderCac) / olderCac) * 100 : 0;

    const recentMelArr = recent.map((m) => m.mel).filter((v): v is number => v !== null && v > 0);
    const recentMelAvg = recentMelArr.length > 0 ? avg(recentMelArr) : 0;

    const recentRecompraAvg = avg(recent.map((m) => m.repurchaseRate));
    const olderRecompraAvg = older.length > 0 ? avg(older.map((m) => m.repurchaseRate)) : recentRecompraAvg;
    const recompraTrendPp = recentRecompraAvg - olderRecompraAvg;

    const mel = periodTotals.mel;
    const reasons: string[] = [];
    const cautions: string[] = [];

    let action: "escalar" | "manter" | "cortar";

    if (mel >= 1.5) {
      action = "escalar";
      reasons.push(`MEL agregado de ${mel.toFixed(2)}x — acima do limite saudável (≥1.5x)`);
      if (recentMelAvg >= 1.5) {
        reasons.push(`Safras recentes (últimos 3m) com MEL médio ${recentMelAvg.toFixed(2)}x — tendência consistente`);
      }

      // Inversões que rebaixam pra manter
      if (cacTrendPct > 30) {
        action = "manter";
        cautions.push(`CAC subiu ${cacTrendPct.toFixed(0)}% nos últimos 3m vs 3m anteriores — sinal de saturação de audiência. Escalar pode estourar CAC.`);
      } else if (cacTrendPct > 15) {
        cautions.push(`CAC subiu ${cacTrendPct.toFixed(0)}% — atenção pra não escalar agressivo demais`);
      }

      if (recompraTrendPp < -2) {
        action = "manter";
        cautions.push(`Taxa de recompra caiu ${Math.abs(recompraTrendPp).toFixed(1)}pp — ICP errado pode estar entrando, LTV futuro vai piorar.`);
      }
    } else if (mel >= 1) {
      action = "manter";
      reasons.push(`MEL ${mel.toFixed(2)}x — entre 1x e 1.5x, no fio`);
      reasons.push("Atacar funil pós-compra (recompra, upsell, retenção) antes de mexer no topo");
      if (recentMelAvg < mel) {
        cautions.push(`MEL recente médio ${recentMelAvg.toFixed(2)}x está pior que o agregado — tendência de piora`);
      }
    } else {
      action = "cortar";
      reasons.push(`MEL ${mel.toFixed(2)}x — abaixo de 1x. Cada cliente novo está queimando dinheiro.`);
      reasons.push("Cortar -20% no spend e investigar funil (CAC alto ou LTV baixo?)");
      if (cacTrendPct > 0) {
        cautions.push(`CAC ainda subindo (+${cacTrendPct.toFixed(0)}% trend) — agrava o problema`);
      }
    }

    const labels = {
      escalar: { label: "ESCALAR", color: "#16a34a", summary: `Aumentar invest em +10-20% por ciclo` },
      manter: { label: "MANTER", color: "#f59e0b", summary: `Manter spend atual, focar em otimização` },
      cortar: { label: "CORTAR", color: "#ef4444", summary: `Reduzir invest em -20% por ciclo` },
    };

    return { action, ...labels[action], reasons, cautions };
  }, [periodTotals.mel, monthlyWithCac]);

  return (
    <TooltipProvider>
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM — Segmentacao de Clientes</h1>
          <p className="text-muted-foreground text-sm">
            Analise RFM e comportamental para comunicacoes personalizadas
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 mt-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleVndaSync}
            disabled={syncing || computing || loading}
            title="Importar todos os pedidos VNDA e corrigir contagem de clientes"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar VNDA"}
          </Button>
          {syncResult && (
            <span className="text-xs text-muted-foreground">{syncResult}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleRecompute}
            disabled={computing || loading || syncing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${computing ? "animate-spin" : ""}`} />
            {computing ? "Atualizando..." : "Atualizar dados"}
          </Button>
          <div className="flex items-center gap-1.5">
            <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Nao perturbe:</span>
            <select
              value={cooldownDays}
              onChange={(e) => setCooldownDays(Number(e.target.value))}
              className="text-xs bg-card border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value={0}>Desativado</option>
              <option value={3}>3 dias</option>
              <option value={7}>7 dias</option>
              <option value={14}>14 dias</option>
              <option value={30}>30 dias</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          title="Total Clientes"
          value={formatNumber(displaySummary.totalCustomers)}
          icon={Users}
          iconColor="text-purple-400"
          loading={loading}
          info={<>Quantidade total de emails únicos que já fizeram pelo menos 1 compra (lifetime). <br/><br/><b>Fonte:</b> snapshot RFM (crm_rfm_snapshots.summary) — base de pedidos VNDA.</>}
        />
        <KpiCard
          title="Ticket Medio"
          value={formatCurrency(displaySummary.avgTicket)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          info={<><b>Fórmula:</b> receita total ÷ total de pedidos (lifetime). <br/><br/>É a média por <i>pedido</i>, não por cliente. <br/><br/><b>Fonte:</b> snapshot RFM.</>}
        />
        <KpiCard
          title="Receita Total"
          value={formatCurrency(displaySummary.totalRevenue)}
          icon={CircleDollarSign}
          iconColor="text-blue-400"
          loading={loading}
          info={<>Soma de todos os <code>valor</code> de pedidos da base (lifetime). <br/><br/><b>Fonte:</b> snapshot RFM, agregado de pedidos VNDA.</>}
        />
        <KpiCard
          title="Clientes Ativos"
          value={formatNumber(displaySummary.activeCustomers)}
          icon={UserCheck}
          iconColor="text-orange-400"
          loading={loading}
          badge="90 dias"
          badgeColor="#f97316"
          info={<>Clientes que fizeram pelo menos 1 compra nos <b>últimos 90 dias</b>. <br/><br/>Métrica de saúde recorrente da base. Se cair, sinal de churn.</>}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="metrics">Metricas</TabsTrigger>
          <TabsTrigger value="overview">Visao Geral</TabsTrigger>
          <TabsTrigger value="segments">Segmentos RFM</TabsTrigger>
          <TabsTrigger value="behavior">Comportamento</TabsTrigger>
          <TabsTrigger value="customers">Clientes</TabsTrigger>
        </TabsList>

        {/* === Action bar — sempre visível pra permitir disparo pra base toda === */}
        <div className="flex items-center gap-2 flex-wrap px-1 py-3 border-b border-border/50">
          {/* Filter chips (only when filters active) */}
          {activeFilters.length > 0 ? (
            <>
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                {invertFilters ? "Base toda EXCETO:" : "Filtros:"}
              </span>
              {activeFilters.map((f) => (
                <button
                  key={`${f.type}-${f.value}`}
                  onClick={f.onRemove}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:opacity-80 cursor-pointer"
                  style={{
                    color: f.color,
                    backgroundColor: `${f.color}15`,
                    border: `1px solid ${f.color}30`,
                    textDecoration: invertFilters ? "line-through" : undefined,
                    textDecorationColor: invertFilters ? f.color : undefined,
                  }}
                >
                  {f.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                onClick={() => setInvertFilters((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:opacity-80 cursor-pointer ml-1 ${
                  invertFilters
                    ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30"
                    : "bg-muted/50 text-muted-foreground border border-border hover:text-foreground"
                }`}
                title={invertFilters
                  ? "Voltar pra modo normal (mostrar quem combina com os filtros)"
                  : "Inverter: mostrar a base EXCETO o que está filtrado"
                }
              >
                ⇄ {invertFilters ? "Invertido" : "Inverter"}
              </button>
              <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 cursor-pointer">
                Limpar filtros
              </button>
            </>
          ) : selectedEmails.size === 0 ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Users className="h-3 w-3" />
              Base toda · {formatNumber(customersLoaded ? filteredCustomers.length : displaySummary.totalCustomers)} clientes
            </span>
          ) : null}
          {selectedEmails.size > 0 && (
            <button
              onClick={() => setSelectedEmails(new Set())}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:opacity-80 cursor-pointer"
              style={{ color: "#3b82f6", backgroundColor: "#3b82f615", border: "1px solid #3b82f630" }}
            >
              {selectedEmails.size} selecionado{selectedEmails.size > 1 ? "s" : ""}
              <X className="h-3 w-3" />
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setTemplateDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Criar Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={customersLoading}
              onClick={async () => {
                // Quando vier de "Base toda" e customers ainda não foi
                // carregado lazy, força agora — senão dispara pra lista vazia.
                let source;
                if (selectedEmails.size > 0) {
                  source = selectedCustomers;
                } else if (customersLoaded) {
                  source = filteredCustomers;
                } else {
                  source = await ensureCustomersLoaded();
                }
                const contacts = source.map((c) => ({ name: c.name, email: c.email }));
                setEmailListContacts(contacts);
                const filterParts = activeFilters
                  .map((f) => f.label)
                  .filter(Boolean);
                if (filterParts.length > 0) {
                  const today = new Date().toISOString().slice(0, 10);
                  setEmailListSuggestedName(
                    `CRM · ${today} · ${filterParts.join(" · ")}`.slice(0, 120)
                  );
                } else {
                  setEmailListSuggestedName(undefined);
                }
                setEmailListDialogOpen(true);
              }}
            >
              <Mail className="h-4 w-4" />
              Lista de email ({selectedEmails.size > 0 ? selectedEmails.size : (customersLoaded ? filteredCustomers.length : displaySummary.totalCustomers)})
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={customersLoading}
              onClick={async () => {
                let source;
                if (selectedEmails.size > 0) {
                  source = selectedCustomers;
                } else if (customersLoaded) {
                  source = filteredCustomers;
                } else {
                  source = await ensureCustomersLoaded();
                }
                const contacts = source.map((c) => ({ name: c.name, email: c.email, phone: c.phone }));
                setCampaignContacts(contacts);
                setCampaignSuggestedName(undefined);
                setCampaignDialogOpen(true);
              }}
            >
              <MessageSquareMore className="h-4 w-4" />
              Campanha WhatsApp ({selectedEmails.size > 0 ? selectedEmails.size : (customersLoaded ? filteredCustomers.length : displaySummary.totalCustomers)})
            </Button>
            <Button variant="default" size="sm" className="gap-1.5" onClick={handleGlobalExport}>
              <Download className="h-4 w-4" />
              Exportar CSV ({filteredCustomers.length})
            </Button>
          </div>
        </div>

        {/* ===== Tab 0: Metricas ===== */}
        <TabsContent value="metrics" className="space-y-6">
          {activeTab === "metrics" && (<>
          {/* Period selector */}
          <div className="flex justify-end">
            <select
              value={metricsPeriod}
              onChange={(e) => setMetricsPeriod(Number(e.target.value))}
              className="text-sm bg-card border border-border rounded-md px-3 py-1.5 text-foreground"
            >
              <option value={6}>Ultimos 6 meses</option>
              <option value={12}>Ultimos 12 meses</option>
              <option value={0}>Todo o periodo</option>
            </select>
          </div>

          {/* KPI Row 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-primary">{metricsLoading ? "..." : formatCurrency(metricsData?.arpu ?? 0)}</p>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Receita Media por Cliente (ARPU)</p>
                <InfoTip>
                  <b>Fórmula:</b> receita total ÷ clientes únicos (lifetime).<br/><br/>
                  Quanto vale um cliente médio em receita acumulada desde sempre.<br/><br/>
                  <b>Fonte:</b> snapshot RFM completo.
                </InfoTip>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : (metricsData?.avgOrdersPerClient ?? 0).toFixed(2)}</p>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Media Pedidos por Cliente</p>
                <InfoTip>
                  <b>Fórmula:</b> total de pedidos ÷ clientes únicos (lifetime).<br/><br/>
                  &gt;1 = a base recompra. Quanto mais alto, melhor a fidelização.
                </InfoTip>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <div className="flex items-center justify-center gap-2">
                <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : formatCurrency(ltv)}</p>
                <span className="text-xs border rounded px-1.5 py-0.5 text-muted-foreground">{mcPct}%</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">LTV = ARPU * MC%</p>
                <InfoTip>
                  <b>Fórmula:</b> ARPU × Margem de Contribuição.<br/><br/>
                  MC% = 100% − (custo produto + tax + frete + desconto + outras + invest), configurada em Financial Settings.<br/><br/>
                  É a parte do ARPU que vira lucro bruto (não confundir com margem líquida).
                </InfoTip>
              </div>
            </Card>
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-5 text-center">
              <div className="flex items-center justify-center gap-3">
                <div>
                  <p className="text-xl font-bold text-foreground">
                    {metricsLoading || cacMedio === null ? "—" : (periodTotals.ltvCohort / cacMedio).toFixed(2) + "x"}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">LTV bruto / CAC</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground" style={{ color: periodTotals.mel === null ? undefined : periodTotals.mel >= 3 ? "#16a34a" : periodTotals.mel >= 1.5 ? "#22c55e" : periodTotals.mel >= 1 ? "#f59e0b" : "#ef4444" }}>
                    {metricsLoading || periodTotals.mel === null ? "—" : periodTotals.mel.toFixed(2) + "x"}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">MEL</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Eficiência de aquisição</p>
                <InfoTip>
                  <b>LTV bruto / CAC:</b> LTV cohort ÷ CAC. Só receita bruta vs custo de aquisição — não conta CMV.<br/><br/>
                  <b>MEL (Margem de Escala Lucrativa):</b> <code>LTV ÷ (CAC + CMV)</code>.<br/><br/>
                  • <b>LTV</b> = receita lifetime da safra ÷ clientes da safra<br/>
                  • <b>CAC</b> = spend Meta + Google Ads ÷ novos clientes do período. <i>Não inclui</i> afiliados, influencer ou agência (não temos esses custos no Vortex hoje), então o CAC real pode ser maior — MEL sai um pouco otimista.<br/>
                  • <b>CMV</b> = LTV × {(cogsPct * 100).toFixed(0)}% — apenas o custo do produto (vem do <i>financial-settings</i>). Frete, impostos e descontos são despesas variáveis e não entram no CMV.<br/><br/>
                  Cor: <span style={{color:"#16a34a"}}>≥3x</span> muito rentável, <span style={{color:"#22c55e"}}>≥1.5x</span> saudável, <span style={{color:"#f59e0b"}}>≥1x</span> no fio, <span style={{color:"#ef4444"}}>&lt;1x</span> queima dinheiro.<br/><br/>
                  <b>vs EBITDA Escala:</b> MEL é por <i>cohort</i> (lifetime, unit economics); EBITDA é snapshot mensal incluindo todos custos + custo fixo.
                </InfoTip>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading || cacMedio === null ? "—" : formatCurrency(cacMedio)}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">CAC Médio</p>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <p className="text-[10px] text-muted-foreground">no período</p>
                <InfoTip>
                  <b>Fórmula:</b> spend total ÷ novos clientes no período.<br/><br/>
                  <b>Spend</b> = Meta Ads (via Graph API, todas as <code>meta_accounts</code> da workspace) + Google Ads (se configurado).<br/><br/>
                  <b>Novos clientes</b> = primeiras compras nos meses visíveis.<br/><br/>
                  Mesma base do gráfico mensal — bate com a média ponderada das barras.
                </InfoTip>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : formatNumber(periodTotals.newClients)}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Clientes Novos</p>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <p className="text-[10px] text-muted-foreground">no período</p>
                <InfoTip>
                  Emails que fizeram <b>primeira compra</b> em algum mês do período selecionado.<br/><br/>
                  Soma das barras verdes do gráfico &quot;Novos vs Recorrentes&quot;.<br/><br/>
                  Não confundir com &quot;Total Clientes&quot; (lifetime).
                </InfoTip>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-primary">{metricsLoading ? "..." : `${(metricsData?.repurchaseRate ?? 0).toFixed(2)}%`}</p>
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Tx. Recompra</p>
                <InfoTip>
                  <b>Fórmula:</b> clientes com 2+ pedidos ÷ total de clientes únicos (lifetime, cumulativo).<br/><br/>
                  Indicador de fidelização. Subindo = base mais saudável.<br/><br/>
                  <b>Fonte:</b> snapshot RFM.
                </InfoTip>
              </div>
            </Card>
          </div>

          {/* Recomendação automática — escalar / manter / cortar */}
          {melRecommendation && (
            <Card
              className="border-l-4 overflow-hidden"
              style={{ borderLeftColor: melRecommendation.color }}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className="rounded-full p-2.5 shrink-0"
                    style={{ backgroundColor: `${melRecommendation.color}20`, color: melRecommendation.color }}
                  >
                    {melRecommendation.action === "escalar" ? <TrendingUp className="h-5 w-5" /> :
                     melRecommendation.action === "cortar" ? <TrendingDown className="h-5 w-5" /> :
                     <Minus className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-semibold tracking-wider" style={{ color: melRecommendation.color }}>
                        RECOMENDAÇÃO: {melRecommendation.label}
                      </h3>
                      <span className="text-xs text-muted-foreground">·</span>
                      <p className="text-sm text-foreground">{melRecommendation.summary}</p>
                      <InfoTip side="bottom">
                        Análise automática baseada em 3 sinais:<br/><br/>
                        <b>1. MEL agregado</b> — saudável ≥1.5x.<br/>
                        <b>2. Trend de CAC</b> — média dos últimos 3m vs 3m anteriores. {">"}+30% indica saturação.<br/>
                        <b>3. Trend de recompra</b> — queda &gt; 2pp indica ICP errado entrando.<br/><br/>
                        <b>MEL ≥1.5x</b> → escalar, salvo CAC disparando ou recompra caindo (vira manter).<br/>
                        <b>1x ≤ MEL &lt;1.5x</b> → manter + otimizar pós-compra.<br/>
                        <b>MEL &lt;1x</b> → cortar -20%.<br/><br/>
                        Não inclui EBITDA do módulo Escala (caixa) — cruze manualmente.
                      </InfoTip>
                    </div>
                    {melRecommendation.reasons.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-1 mt-2">
                        {melRecommendation.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-foreground/40 mt-0.5">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {melRecommendation.cautions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Atenção</p>
                        <ul className="text-xs space-y-1">
                          {melRecommendation.cautions.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-amber-600 dark:text-amber-500">
                              <span className="mt-0.5">⚠</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="Novos vs Recorrentes"
              info={<>
                <b>Novos</b> (verde): clientes na primeira compra do mês.<br/>
                <b>Recorrentes</b> (cinza): clientes que já haviam comprado antes.<br/><br/>
                Mês = data de compra. Receita não entra aqui — é puramente cabeças.<br/><br/>
                <b>Fonte:</b> snapshot RFM, agregado de pedidos VNDA por mês.
              </>}
              loading={metricsLoading} isEmpty={monthlyWithCac.length === 0} height={250}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyWithCac}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="month" tick={{ fill: chart.axis, fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: chart.axis, fontSize: 11 }} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="newClients" name="Novos" fill="#4ade80" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="returningClients" name="Recorrentes" fill="#6b7280" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Qtd Pedidos"
              info={<>
                Total de pedidos (não clientes) por mês.<br/><br/>
                Inclui múltiplos pedidos do mesmo cliente. Útil pra ver volume operacional vs &quot;Novos vs Recorrentes&quot; que mede cabeças.<br/><br/>
                <b>Fonte:</b> snapshot RFM.
              </>}
              loading={metricsLoading} isEmpty={monthlyWithCac.length === 0} height={250}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyWithCac}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="month" tick={{ fill: chart.axis, fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: chart.axis, fontSize: 11 }} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Area type="monotone" dataKey="totalOrders" stroke={chart.series[0]} fill={`${chart.series[0]}20`} strokeWidth={2} dot={{ r: 3, fill: chart.series[0] }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="LTV vs CAC por Safra"
              subtitle="LTV bruto realizado (lifetime) vs CAC. Linha = margem (LTV×MC%). Safras recentes têm menos tempo pra desenvolver LTV."
              info={<>
                <b>Barras azuis (LTV):</b> receita lifetime acumulada dos clientes da safra ÷ qtd da safra.<br/><br/>
                <b>Barras vermelhas (CAC):</b> spend Meta+Google do mês ÷ novos clientes do mês.<br/><br/>
                <b>Linha verde tracejada (Margem):</b> LTV × MC%. Para a safra ser rentável, precisa estar <i>acima</i> da barra vermelha.<br/><br/>
                <b>Viés:</b> safras recentes naturalmente têm LTV menor (menos tempo de maturação). Use o cohort heatmap pra comparar safras no mesmo M+N.
              </>}
              loading={metricsLoading}
              isEmpty={monthlyWithCac.length === 0 || !adSpend}
              height={300}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyWithCac.map((m) => ({
                  ...m,
                  ltvMargin: m.cohortLtv * (mcPct / 100),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="month" tick={{ fill: chart.axis, fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: chart.axis, fontSize: 11 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip
                    contentStyle={chart.tooltipStyle}
                    formatter={(v, name) => [
                      v !== null && v !== undefined ? formatCurrency(Number(v)) : "—",
                      String(name),
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="cohortLtv" name="LTV (lifetime)" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cac" name="CAC" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="ltvMargin" name={`Margem (${mcPct.toFixed(0)}% LTV)`} stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Cohort Heatmap — uma única tabela com seletor de métrica */}
          <CohortHeatmap
            data={monthlyWithCac}
            loading={metricsLoading}
            metric={cohortMetric}
            onMetricChange={setCohortMetric}
          />

          {/* Monthly table */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-base">Evolucao Mensal</CardTitle>
                <InfoTip>
                  Tabela mensal com os dados que alimentam todos os gráficos.<br/><br/>
                  <b>Tkt Total/Novos/Antigos:</b> ticket médio por pedido naquele segmento.<br/>
                  <b>Receita Novos/Antigos:</b> soma de pedidos naquele segmento.<br/>
                  <b>CAC:</b> spend Meta+Google do mês ÷ Novos.<br/>
                  <b>LTV:</b> receita lifetime da safra ÷ Novos.<br/>
                  <b>LTV:CAC:</b> razão da safra (verde ≥3x).<br/>
                  <b>MEL:</b> LTV ÷ (CAC + COGS). Margem de Escala Lucrativa — verde ≥1.5x, vermelho &lt;1x.<br/>
                  <b>Pedidos/Cli:</b> pedidos médios por cliente da safra (lifetime).<br/>
                  <b>Idade:</b> meses desde a safra. Quanto maior, mais maturo o LTV.<br/>
                  <b>Recompra:</b> % de clientes com 2+ pedidos até esse mês.
                </InfoTip>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {metricsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : monthlyWithCac.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-3 px-2 text-left">Mes</th>
                      <th className="py-3 px-2 text-right">Total Clientes</th>
                      <th className="py-3 px-2 text-right">Tkt Total</th>
                      <th className="py-3 px-2 text-right">Novos</th>
                      <th className="py-3 px-2 text-right">Tkt Novos</th>
                      <th className="py-3 px-2 text-right">Receita Novos</th>
                      <th className="py-3 px-2 text-right">Antigos</th>
                      <th className="py-3 px-2 text-right">Tkt Antigos</th>
                      <th className="py-3 px-2 text-right">Receita Antigos</th>
                      <th className="py-3 px-2 text-right" title="Custo de Aquisição da Safra: spend Meta do mês ÷ novos clientes do mês">CAC</th>
                      <th className="py-3 px-2 text-right" title="LTV bruto realizado: receita acumulada (lifetime) dos clientes que entraram nessa safra ÷ qtd de clientes da safra">LTV</th>
                      <th className="py-3 px-2 text-right" title="LTV ÷ CAC. Saudável > 3x. Lembre que safras recentes têm pouco tempo pra desenvolver LTV.">LTV:CAC</th>
                      <th className="py-3 px-2 text-right" title="MEL = LTV ÷ (CAC + COGS). Saudável >= 1.5x. Considera tanto custo de aquisição quanto custo do produto.">MEL</th>
                      <th className="py-3 px-2 text-right" title="Pedidos médios por cliente da safra (lifetime)">Pedidos/Cli</th>
                      <th className="py-3 px-2 text-right" title="Meses desde a safra — quanto mais antiga, mais maduro o LTV">Idade</th>
                      <th className="py-3 px-2 text-right">Recompra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyWithCac.map((row) => {
                      const ltvCacRatio = row.cac !== null && row.cac > 0
                        ? row.cohortLtv / row.cac
                        : null;
                      const ratioColor = ltvCacRatio === null
                        ? undefined
                        : ltvCacRatio >= 3 ? "#16a34a" // verde
                        : ltvCacRatio >= 1 ? "#f59e0b" // âmbar
                        : "#ef4444"; // vermelho
                      return (
                      <tr key={row.monthKey} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="py-3 px-2 font-medium">{row.month}</td>
                        <td className="py-3 px-2 text-right font-semibold">{formatNumber(row.totalClients)}</td>
                        <td className="py-3 px-2 text-right">{formatCurrency(row.avgTicket)}</td>
                        <td className="py-3 px-2 text-right font-semibold">{formatNumber(row.newClients)}</td>
                        <td className="py-3 px-2 text-right">{formatCurrency(row.avgTicketNew)}</td>
                        <td className="py-3 px-2 text-right">{formatCurrency(row.revenueNew)}</td>
                        <td className="py-3 px-2 text-right font-semibold">{formatNumber(row.returningClients)}</td>
                        <td className="py-3 px-2 text-right">{formatCurrency(row.avgTicketReturning)}</td>
                        <td className="py-3 px-2 text-right">{formatCurrency(row.revenueReturning)}</td>
                        <td className="py-3 px-2 text-right font-semibold" style={{ color: row.cac !== null ? "#ef4444" : undefined }}>
                          {row.cac !== null ? formatCurrency(row.cac) : "—"}
                        </td>
                        <td className="py-3 px-2 text-right font-semibold" style={{ color: row.cohortLtv > 0 ? "#3b82f6" : undefined }}>
                          {row.cohortLtv > 0 ? formatCurrency(row.cohortLtv) : "—"}
                        </td>
                        <td className="py-3 px-2 text-right font-semibold" style={{ color: ratioColor }}>
                          {ltvCacRatio !== null ? `${ltvCacRatio.toFixed(2)}x` : "—"}
                        </td>
                        <td className="py-3 px-2 text-right font-semibold" style={{
                          color: row.mel === null
                            ? undefined
                            : row.mel >= 3 ? "#16a34a"
                            : row.mel >= 1.5 ? "#22c55e"
                            : row.mel >= 1 ? "#f59e0b"
                            : "#ef4444"
                        }}>
                          {row.mel !== null ? `${row.mel.toFixed(2)}x` : "—"}
                        </td>
                        <td className="py-3 px-2 text-right">{row.cohortAvgOrdersPerClient > 0 ? row.cohortAvgOrdersPerClient.toFixed(2) : "—"}</td>
                        <td className="py-3 px-2 text-right text-muted-foreground">{row.cohortMonthsTracked}m</td>
                        <td className="py-3 px-2 text-right">{row.repurchaseRate.toFixed(2)}%</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          </>)}
        </TabsContent>

        {/* ===== Tab 1: Overview ===== */}
        <TabsContent value="overview" className="space-y-6">
          {activeTab === "overview" && (<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Distribuicao por Segmento" loading={loading} isEmpty={segmentPieData.length === 0} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart className="cursor-pointer">
                  <Pie data={segmentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={3}
                    label={({ name, value }) => `${name} (${value})`} labelLine={{ strokeWidth: 1 }}>
                    {segmentPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent"
                        opacity={segmentFilter === "all" || SEGMENT_LABEL_TO_KEY[entry.name] === segmentFilter ? 1 : 0.3}
                        className="cursor-pointer" onClick={() => handleSegmentChartClick(entry)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Receita por Segmento" loading={loading} isEmpty={revenueBySegmentData.length === 0} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBySegmentData} layout="vertical" className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis type="number" stroke={chart.axis} fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" stroke={chart.axis} fontSize={11} width={120} tickLine={false} />
                  <Tooltip contentStyle={chart.tooltipStyle} formatter={(value: number | undefined) => [formatCurrency(value ?? 0), "Receita"]} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} onClick={handleSegmentChartClick}>
                    {revenueBySegmentData.map((entry, i) => (
                      <Cell key={i} fill={entry.color}
                        opacity={segmentFilter === "all" || SEGMENT_LABEL_TO_KEY[entry.name] === segmentFilter ? 1 : 0.3}
                        className="cursor-pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Distribuicao de Recencia" loading={loading} isEmpty={distributions.recency.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributions.recency}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="bucket" stroke={chart.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Distribuicao de Frequencia" loading={loading} isEmpty={distributions.frequency.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributions.frequency}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="bucket" stroke={chart.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Export History */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Exportacoes Recentes</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {exportLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma exportacao registrada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Data</th>
                        <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                        <th className="text-left py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Filtros</th>
                        <th className="text-right py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Registros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportLogs.slice(0, 15).map((log) => (
                        <tr key={log.id} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-2 px-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                              {log.export_type.replace(/_/g, " ").replace(/^crm-?/, "")}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground max-w-[200px] truncate">
                            {log.filters ? Object.entries(log.filters).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-medium">{formatNumber(log.record_count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          </>)}
        </TabsContent>

        {/* ===== Tab 2: Segments ===== */}
        <TabsContent value="segments" className="space-y-6">
          {activeTab === "segments" && (<>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : segments.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem dados de segmentacao.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {segments.map((seg) => (
                <Card key={seg.segment}
                  className={`hover:border-primary/30 transition-colors cursor-pointer ${segmentFilter === seg.segment ? "border-primary ring-1 ring-primary/30" : ""}`}
                  onClick={() => handleSegmentClick(seg.segment)}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                      <h3 className="font-semibold text-sm">{seg.label}</h3>
                      <span className="ml-auto text-lg font-bold">{seg.customerCount}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{seg.description}</p>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Receita</p>
                        <p className="text-sm font-semibold">{formatCurrency(seg.totalRevenue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ticket</p>
                        <p className="text-sm font-semibold">{formatCurrency(seg.avgTicket)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recencia</p>
                        <p className="text-sm font-semibold">{seg.avgRecency}d</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          </>)}
        </TabsContent>

        {/* ===== Tab 3: Behavior ===== */}
        <TabsContent value="behavior" className="space-y-6">
          {activeTab === "behavior" && (<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Preferencia de Dia do Mes" loading={loading} isEmpty={behavioral.dayOfMonth.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.dayOfMonth} className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="bucket" stroke={chart.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]} onClick={handleDayOfMonthClick}>
                    {behavioral.dayOfMonth.map((entry, i) => (
                      <Cell key={i} fill="#3b82f6" opacity={dayRangeFilter === "all" || DAYRANGE_LABEL_TO_KEY[entry.bucket] === dayRangeFilter ? 1 : 0.3} className="cursor-pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Turno Preferido" loading={loading} isEmpty={behavioral.hourOfDay.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.hourOfDay} className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="bucket" stroke={chart.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]} onClick={handleHourClick}>
                    {behavioral.hourOfDay.map((entry, i) => (
                      <Cell key={i} fill="#f59e0b" opacity={hourFilter === "all" || HOUR_LABEL_TO_KEY[entry.bucket] === hourFilter ? 1 : 0.3} className="cursor-pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Sensibilidade a Cupom" loading={loading} isEmpty={behavioral.couponUsage.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart className="cursor-pointer">
                  <Pie data={behavioral.couponUsage} dataKey="count" nameKey="bucket" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={3}
                    label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""} (${value ?? 0})`} labelLine={{ strokeWidth: 1 }}>
                    {behavioral.couponUsage.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent"
                        opacity={couponFilter === "all" || COUPON_LABEL_TO_KEY[entry.bucket] === couponFilter ? 1 : 0.3}
                        className="cursor-pointer" onClick={() => handleCouponClick(entry)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Estagio do Ciclo de Vida" loading={loading} isEmpty={behavioral.lifecycle.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.lifecycle} className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="bucket" stroke={chart.axis} fontSize={12} tickLine={false} />
                  <YAxis stroke={chart.axis} fontSize={12} />
                  <Tooltip contentStyle={chart.tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]} onClick={handleLifecycleClick}>
                    {behavioral.lifecycle.map((entry, i) => (
                      <Cell key={i} fill={entry.color}
                        opacity={lifecycleFilter === "all" || LIFECYCLE_LABEL_TO_KEY[entry.bucket] === lifecycleFilter ? 1 : 0.3}
                        className="cursor-pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard title="Dia da Semana Preferido" loading={loading} isEmpty={behavioral.weekday.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={behavioral.weekday} className="cursor-pointer">
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="bucket" stroke={chart.axis} fontSize={12} tickLine={false} />
                <YAxis stroke={chart.axis} fontSize={12} />
                <Tooltip contentStyle={chart.tooltipStyle} />
                <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]} onClick={handleWeekdayClick}>
                  {(behavioral.weekday || []).map((entry, i) => (
                    <Cell key={i} fill={entry.color}
                      opacity={weekdayFilter === "all" || WEEKDAY_LABEL_TO_KEY[entry.bucket] === weekdayFilter ? 1 : 0.3}
                      className="cursor-pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          </>)}
        </TabsContent>

        {/* ===== Tab 4: Customers ===== */}
        <TabsContent value="customers" className="space-y-4">
          {activeTab === "customers" && (customersLoading && !customersLoaded ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Carregando clientes...</p>
            </div>
          ) : (<>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, email ou telefone..." value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} className="pl-9" />
            </div>
            <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value as RfmSegment | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${segmentFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos os segmentos</option>
              {segments.map((seg) => (<option key={seg.segment} value={seg.segment}>{seg.label} ({seg.customerCount})</option>))}
            </select>
            <select value={dayRangeFilter} onChange={(e) => setDayRangeFilter(e.target.value as DayRange | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${dayRangeFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos os dias do mes</option>
              <option value="1-5">Dia 1-5</option>
              <option value="6-10">Dia 6-10</option>
              <option value="11-15">Dia 11-15</option>
              <option value="16-20">Dia 16-20</option>
              <option value="21-25">Dia 21-25</option>
              <option value="26-31">Dia 26-31</option>
            </select>
            <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value as LifecycleStage | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${lifecycleFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos os estagios</option>
              <option value="new">Novo (1 compra)</option>
              <option value="returning">Retornante (2-3)</option>
              <option value="regular">Regular (4-10)</option>
              <option value="vip">VIP (11+)</option>
            </select>
            <select value={hourFilter} onChange={(e) => setHourFilter(e.target.value as HourPref | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${hourFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos os turnos</option>
              <option value="madrugada">Madrugada (0-6h)</option>
              <option value="manha">Manha (6-12h)</option>
              <option value="tarde">Tarde (12-18h)</option>
              <option value="noite">Noite (18-24h)</option>
            </select>
            <select value={couponFilter} onChange={(e) => setCouponFilter(e.target.value as CouponSensitivity | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${couponFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos cupons</option>
              <option value="never">Nunca usa cupom</option>
              <option value="occasional">Cupom ocasional</option>
              <option value="frequent">Cupom frequente</option>
              <option value="always">Sempre usa cupom</option>
            </select>
            <select value={weekdayFilter} onChange={(e) => setWeekdayFilter(e.target.value as Weekday | "all")}
              className={`h-10 rounded-md border px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 ${weekdayFilter !== "all" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
              <option value="all">Todos os dias</option>
              <option value="seg">Segunda</option>
              <option value="ter">Terca</option>
              <option value="qua">Quarta</option>
              <option value="qui">Quinta</option>
              <option value="sex">Sexta</option>
              <option value="sab">Sabado</option>
              <option value="dom">Domingo</option>
            </select>

            {/* --- Estado(s): popover com tilemap clicável --- */}
            <Popover open={stateTilemapOpen} onOpenChange={setStateTilemapOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`h-10 ${stateFilter.size > 0 ? "border-primary bg-primary/5" : ""}`}
                >
                  Estado{stateFilter.size > 0 ? `s (${stateFilter.size})` : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px]" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Filtrar por UF</div>
                      <p className="text-xs text-muted-foreground">
                        Clique pra adicionar/remover. Compõe com os outros filtros (AND).
                      </p>
                    </div>
                    {stateFilter.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setStateFilter(new Set())}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                  <StateTilemap
                    counts={(() => {
                      // Contagem de clientes por UF da base atual — prefere
                      // c.state se já estiver no snapshot.
                      const c: Record<string, number> = {};
                      for (const cust of customers) {
                        const uf = cust.state ?? customerStates[cust.email];
                        if (uf) c[uf] = (c[uf] ?? 0) + 1;
                      }
                      return c;
                    })()}
                    selected={stateFilter}
                    onToggle={(uf) => {
                      setStateFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(uf)) next.delete(uf);
                        else next.add(uf);
                        return next;
                      });
                    }}
                  />
                  {stateFilter.size > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2 border-t">
                      {[...stateFilter].map((uf) => (
                        <button
                          key={uf}
                          type="button"
                          onClick={() => setStateFilter((prev) => {
                            const next = new Set(prev);
                            next.delete(uf);
                            return next;
                          })}
                          className="text-xs px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                          title={`Remover ${STATE_NAMES[uf]}`}
                        >
                          {uf} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* --- Advanced filters: date range + numeric range --- */}
            <DateRangeFilterPopover
              label="Comprou em periodo"
              value={purchasedDateRange}
              onChange={setPurchasedDateRange}
            />
            <DateRangeFilterPopover
              label="Inativo desde"
              value={inactiveDateRange}
              onChange={setInactiveDateRange}
            />
            <NumericRangeFilterPopover
              label="Ticket medio"
              value={avgTicketRange}
              onChange={setAvgTicketRange}
            />
            <NumericRangeFilterPopover
              label="Compra acumulada"
              value={totalSpentRange}
              onChange={setTotalSpentRange}
            />
          </div>

          <PerformanceTable
            title={`Clientes (${filteredCustomers.length})`}
            sortable
            columns={[
              { key: "name", label: "Nome" },
              { key: "email", label: "Email" },
              { key: "totalPurchases", label: "Compras", format: "number", align: "right" },
              { key: "totalSpent", label: "Total Gasto", format: "currency", align: "right" },
              { key: "avgTicket", label: "Ticket", format: "currency", align: "right" },
              { key: "lastPurchaseDate", label: "Ultima Compra", align: "center" },
              {
                key: "daysSinceLastPurchase", label: "Dias", align: "right",
                render: (v) => {
                  const days = Number(v);
                  const color = days <= 30 ? "text-success" : days <= 90 ? "text-yellow-400" : "text-destructive";
                  return <span className={`font-medium ${color}`}>{days >= 9999 ? "—" : days}</span>;
                },
              },
              { key: "rfmScore", label: "RFM", align: "center", render: (v) => <RfmScoreBadge score={String(v)} /> },
              { key: "segment", label: "Segmento", align: "center", render: (v) => <SegmentBadge segment={v as RfmSegment} /> },
              { key: "lifecycleStage", label: "Ciclo", align: "center", render: (v) => <LifecycleBadge stage={v as LifecycleStage} /> },
              { key: "preferredDayRange", label: "Dia Mes", align: "center", render: (v) => <span className="text-xs text-muted-foreground">{String(v)}</span> },
            ]}
            data={filteredCustomers as unknown as Record<string, unknown>[]}
            loading={loading}
            onRowClick={handleRowSelect}
            selectedSet={selectedEmails}
            selectedKey="email"
            pageSize={50}
          />
          </>))}
        </TabsContent>
      </Tabs>

      {/* AI Agent Floating Button */}
      <button
        onClick={() => setAgentPanelOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-sky-500 hover:bg-sky-600 text-white shadow-lg shadow-sky-500/25 flex items-center justify-center transition-all hover:scale-105 z-40"
        title="Agente CRM — Sugestoes de hipersegmentacao"
      >
        <Bot className="h-6 w-6" />
      </button>

      {/* CRM Agent Panel */}
      <CrmAgentPanel
        open={agentPanelOpen}
        onOpenChange={setAgentPanelOpen}
        onApplyFilters={handleAgentApplyFilters}
        onCreateCampaign={handleAgentCreateCampaign}
        cooldownDays={cooldownDays}
      />

      {/* Campaign Create Dialog */}
      <CampaignCreateDialog
        open={campaignDialogOpen}
        onOpenChange={setCampaignDialogOpen}
        contacts={campaignContacts}
        suggestedName={campaignSuggestedName}
        cooldownDays={cooldownDays}
      />

      {/* Template Create Dialog */}
      <TemplateCreateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
      />

      {/* Email List Create Dialog (Locaweb) */}
      <EmailListCreateDialog
        open={emailListDialogOpen}
        onOpenChange={setEmailListDialogOpen}
        contacts={emailListContacts}
        suggestedName={emailListSuggestedName}
      />
    </div>
    </TooltipProvider>
  );
}
