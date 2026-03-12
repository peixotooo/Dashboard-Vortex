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
} from "lucide-react";
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

// --- Constants ---

const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

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

function ChartCard({
  title, loading, isEmpty, height = 250, children, actions,
}: {
  title: string; loading: boolean; isEmpty: boolean; height?: number;
  children: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<NodeJS.Timeout>(undefined);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);
  const [segmentFilter, setSegmentFilter] = useState<RfmSegment | "all">("all");
  const [dayRangeFilter, setDayRangeFilter] = useState<DayRange | "all">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | "all">("all");
  const [hourFilter, setHourFilter] = useState<HourPref | "all">("all");
  const [couponFilter, setCouponFilter] = useState<CouponSensitivity | "all">("all");
  const [weekdayFilter, setWeekdayFilter] = useState<Weekday | "all">("all");
  const [purchasedDateRange, setPurchasedDateRange] = useState<{ from: string; to: string } | null>(null);
  const [inactiveDateRange, setInactiveDateRange] = useState<{ from: string; to: string } | null>(null);
  const [avgTicketRange, setAvgTicketRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [totalSpentRange, setTotalSpentRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [activeTab, setActiveTab] = useState("metrics");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [cooldownDays, setCooldownDays] = useState(7);

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
  const [financialSettings, setFinancialSettings] = useState<{
    product_cost_pct: number; tax_pct: number; frete_pct: number;
    desconto_pct: number; other_expenses_pct: number; invest_pct: number;
  } | null>(null);

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
      const res = await fetch("/api/crm/rfm", { headers: wsHeaders() });
      const data = await res.json();
      setCustomers(data.customers || []);
      setCustomersLoaded(true);
    } catch {
      // Keep empty state
    } finally {
      setCustomersLoading(false);
    }
  }, [wsHeaders, customersLoaded]);

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

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const [cohortRes, finRes] = await Promise.all([
        fetch(`/api/crm/cohort?months=${metricsPeriod}`, { headers: wsHeaders() }),
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

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    let list = customers;
    if (segmentFilter !== "all") list = list.filter((c) => c.segment === segmentFilter);
    if (dayRangeFilter !== "all") list = list.filter((c) => c.preferredDayRange === dayRangeFilter);
    if (lifecycleFilter !== "all") list = list.filter((c) => c.lifecycleStage === lifecycleFilter);
    if (hourFilter !== "all") list = list.filter((c) => c.preferredHour === hourFilter);
    if (couponFilter !== "all") list = list.filter((c) => c.couponSensitivity === couponFilter);
    if (weekdayFilter !== "all") list = list.filter((c) => c.preferredWeekday === weekdayFilter);
    if (purchasedDateRange) list = list.filter((c) => c.lastPurchaseDate >= purchasedDateRange.from && c.firstPurchaseDate <= purchasedDateRange.to);
    if (inactiveDateRange) list = list.filter((c) => c.lastPurchaseDate < inactiveDateRange.from);
    if (avgTicketRange.min !== null) list = list.filter((c) => c.avgTicket >= avgTicketRange.min!);
    if (avgTicketRange.max !== null) list = list.filter((c) => c.avgTicket <= avgTicketRange.max!);
    if (totalSpentRange.min !== null) list = list.filter((c) => c.totalSpent >= totalSpentRange.min!);
    if (totalSpentRange.max !== null) list = list.filter((c) => c.totalSpent <= totalSpentRange.max!);
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q)
      );
    }
    return list;
  }, [customers, segmentFilter, dayRangeFilter, lifecycleFilter, hourFilter, couponFilter, weekdayFilter, purchasedDateRange, inactiveDateRange, avgTicketRange, totalSpentRange, debouncedSearch]);

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

  const totalAdSpend = useMemo(() => {
    if (!adSpend) return null;
    return Object.values(adSpend).reduce((s, v) => s + v, 0);
  }, [adSpend]);

  const cacMedio = useMemo(() => {
    if (totalAdSpend === null || !metricsData || metricsData.newClients === 0) return null;
    return totalAdSpend / metricsData.newClients;
  }, [totalAdSpend, metricsData]);

  const ltv = useMemo(() => {
    if (!metricsData) return 0;
    return metricsData.arpu * (mcPct / 100);
  }, [metricsData, mcPct]);

  // Monthly data with CAC computed
  const monthlyWithCac = useMemo(() => {
    return monthlyData.map((m) => {
      const spend = adSpend?.[m.monthKey] ?? null;
      const cac = spend !== null && m.newClients > 0 ? spend / m.newClients : null;
      return { ...m, adSpend: spend, cac };
    });
  }, [monthlyData, adSpend]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM — Segmentacao de Clientes</h1>
          <p className="text-muted-foreground text-sm">
            Analise RFM e comportamental para comunicacoes personalizadas
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <ShieldOff className="h-4 w-4 text-muted-foreground" />
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard title="Total Clientes" value={formatNumber(displaySummary.totalCustomers)} icon={Users} iconColor="text-purple-400" loading={loading} />
        <KpiCard title="Ticket Medio" value={formatCurrency(displaySummary.avgTicket)} icon={DollarSign} iconColor="text-success" loading={loading} />
        <KpiCard title="Receita Total" value={formatCurrency(displaySummary.totalRevenue)} icon={CircleDollarSign} iconColor="text-blue-400" loading={loading} />
        <KpiCard title="Clientes Ativos" value={formatNumber(displaySummary.activeCustomers)} icon={UserCheck} iconColor="text-orange-400" loading={loading} badge="90 dias" badgeColor="#f97316" />
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

        {/* === Hypersegmentation filter bar === */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-1 py-3 border-b border-border/50">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Filtros:</span>
            {activeFilters.map((f) => (
              <button
                key={`${f.type}-${f.value}`}
                onClick={f.onRemove}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:opacity-80 cursor-pointer"
                style={{ color: f.color, backgroundColor: `${f.color}15`, border: `1px solid ${f.color}30` }}
              >
                {f.label}
                <X className="h-3 w-3" />
              </button>
            ))}
            <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 cursor-pointer">
              Limpar filtros
            </button>
            <div className="ml-auto">
              <Button variant="default" size="sm" className="gap-1.5" onClick={handleGlobalExport}>
                <Download className="h-4 w-4" />
                Exportar CSV ({filteredCustomers.length})
              </Button>
            </div>
          </div>
        )}

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
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Receita Media por Cliente (ARPU)</p>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : (metricsData?.avgOrdersPerClient ?? 0).toFixed(2)}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Media Pedidos por Cliente</p>
            </Card>
            <Card className="p-5 text-center">
              <div className="flex items-center justify-center gap-2">
                <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : formatCurrency(ltv)}</p>
                <span className="text-xs border rounded px-1.5 py-0.5 text-muted-foreground">{mcPct}%</span>
              </div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">LTV = ARPU * MC%</p>
            </Card>
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-5 text-center">
              <div className="flex items-center justify-center gap-3">
                <div>
                  <p className="text-xl font-bold text-foreground">{metricsLoading || cacMedio === null ? "—" : (metricsData!.arpu / cacMedio).toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">ARPU / CAC</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{metricsLoading || cacMedio === null ? "—" : (ltv / cacMedio).toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">LTV / CAC</p>
                </div>
              </div>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading || cacMedio === null ? "—" : formatCurrency(cacMedio)}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">CAC Medio</p>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-foreground">{metricsLoading ? "..." : formatNumber(metricsData?.newClients ?? 0)}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Clientes Novos</p>
            </Card>
            <Card className="p-5 text-center">
              <p className="text-2xl font-bold text-primary">{metricsLoading ? "..." : `${(metricsData?.repurchaseRate ?? 0).toFixed(2)}%`}</p>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Tx. Recompra</p>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Novos vs Recorrentes" loading={metricsLoading} isEmpty={monthlyWithCac.length === 0} height={250}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyWithCac}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="newClients" name="Novos" fill="#4ade80" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="returningClients" name="Recorrentes" fill="#6b7280" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Qtd Pedidos" loading={metricsLoading} isEmpty={monthlyWithCac.length === 0} height={250}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyWithCac}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="totalOrders" stroke="#ffffff" fill="#ffffff10" strokeWidth={2} dot={{ r: 3, fill: "#ffffff" }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="CAC" loading={metricsLoading} isEmpty={monthlyWithCac.length === 0 || !adSpend} height={250}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyWithCac}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), "CAC"]} />
                  <Line type="monotone" dataKey="cac" stroke="#4ade80" strokeWidth={2} dot={{ r: 4, fill: "#4ade80" }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Monthly table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolucao Mensal</CardTitle>
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
                      <th className="py-3 px-2 text-right">CAC</th>
                      <th className="py-3 px-2 text-right">Recompra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyWithCac.map((row) => (
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
                        <td className="py-3 px-2 text-right">{row.repurchaseRate.toFixed(2)}%</td>
                      </tr>
                    ))}
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
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Receita por Segmento" loading={loading} isEmpty={revenueBySegmentData.length === 0} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBySegmentData} layout="vertical" className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis type="number" stroke="#8888a0" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" stroke="#8888a0" fontSize={11} width={120} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number | undefined) => [formatCurrency(value ?? 0), "Receita"]} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Distribuicao de Frequencia" loading={loading} isEmpty={distributions.frequency.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributions.frequency}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
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
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Estagio do Ciclo de Vida" loading={loading} isEmpty={behavioral.lifecycle.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.lifecycle} className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={12} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                <XAxis dataKey="bucket" stroke="#8888a0" fontSize={12} tickLine={false} />
                <YAxis stroke="#8888a0" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
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
        cooldownDays={cooldownDays}
      />
    </div>
  );
}
