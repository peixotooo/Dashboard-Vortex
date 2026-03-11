"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Users,
  DollarSign,
  CircleDollarSign,
  UserCheck,
  Search,
  Loader2,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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
} from "@/lib/crm-rfm";
import { SEGMENT_META, LIFECYCLE_META, COUPON_META, WEEKDAY_META } from "@/lib/crm-rfm";

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

// --- Inline export select+button for behavior charts ---

function ExportSelect({
  options,
  filterFn,
  customers,
  filenamePrefix,
  onExport,
}: {
  options: { value: string; label: string }[];
  filterFn: (c: RfmCustomer, value: string) => boolean;
  customers: RfmCustomer[];
  filenamePrefix: string;
  onExport?: (type: string, filters: Record<string, string>, count: number) => void;
}) {
  const [selected, setSelected] = React.useState(options[0]?.value ?? "");
  const count = customers.filter((c) => filterFn(c, selected)).length;

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Button
        variant="outline" size="sm"
        className="h-8 text-xs gap-1"
        onClick={(e) => {
          e.stopPropagation();
          const filtered = customers.filter((c) => filterFn(c, selected));
          const label = options.find((o) => o.value === selected)?.label ?? selected;
          exportCustomersCsv(filtered, `${filenamePrefix}-${label}`);
          onExport?.(filenamePrefix, { value: selected, label }, filtered.length);
        }}
      >
        <Download className="h-3 w-3" />
        CSV ({count})
      </Button>
    </div>
  );
}

// --- Page ---

export default function CrmPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<RfmSegment | "all">("all");
  const [dayRangeFilter, setDayRangeFilter] = useState<DayRange | "all">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | "all">("all");
  const [hourFilter, setHourFilter] = useState<HourPref | "all">("all");
  const [couponFilter, setCouponFilter] = useState<CouponSensitivity | "all">("all");
  const [weekdayFilter, setWeekdayFilter] = useState<Weekday | "all">("all");
  const [activeTab, setActiveTab] = useState("overview");

  const [customers, setCustomers] = useState<RfmCustomer[]>([]);
  const [segments, setSegments] = useState<RfmSegmentSummary[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [distributions, setDistributions] = useState(emptyDistributions);
  const [behavioral, setBehavioral] = useState(emptyBehavioral);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/rfm", { headers: wsHeaders() });
      const data = await res.json();

      setCustomers(data.customers || []);
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

  useEffect(() => {
    fetchData();
    fetchExportLogs();
  }, [fetchData, fetchExportLogs]);

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    let list = customers;
    if (segmentFilter !== "all") list = list.filter((c) => c.segment === segmentFilter);
    if (dayRangeFilter !== "all") list = list.filter((c) => c.preferredDayRange === dayRangeFilter);
    if (lifecycleFilter !== "all") list = list.filter((c) => c.lifecycleStage === lifecycleFilter);
    if (hourFilter !== "all") list = list.filter((c) => c.preferredHour === hourFilter);
    if (couponFilter !== "all") list = list.filter((c) => c.couponSensitivity === couponFilter);
    if (weekdayFilter !== "all") list = list.filter((c) => c.preferredWeekday === weekdayFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q)
      );
    }
    return list;
  }, [customers, segmentFilter, dayRangeFilter, lifecycleFilter, hourFilter, couponFilter, weekdayFilter, searchQuery]);

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

  // Handle segment card click
  const handleSegmentClick = (segment: RfmSegment) => {
    setSegmentFilter(segment);
    setDayRangeFilter("all");
    setLifecycleFilter("all");
    setHourFilter("all");
    setCouponFilter("all");
    setWeekdayFilter("all");
    setActiveTab("customers");
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CRM — Segmentacao de Clientes</h1>
        <p className="text-muted-foreground text-sm">
          Analise RFM e comportamental para comunicacoes personalizadas
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard title="Total Clientes" value={formatNumber(summary.totalCustomers)} icon={Users} iconColor="text-purple-400" loading={loading} />
        <KpiCard title="Ticket Medio" value={formatCurrency(summary.avgTicket)} icon={DollarSign} iconColor="text-success" loading={loading} />
        <KpiCard title="Receita Total" value={formatCurrency(summary.totalRevenue)} icon={CircleDollarSign} iconColor="text-blue-400" loading={loading} />
        <KpiCard title="Clientes Ativos" value={formatNumber(summary.activeCustomers)} icon={UserCheck} iconColor="text-orange-400" loading={loading} badge="90 dias" badgeColor="#f97316" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Visao Geral</TabsTrigger>
          <TabsTrigger value="segments">Segmentos RFM</TabsTrigger>
          <TabsTrigger value="behavior">Comportamento</TabsTrigger>
          <TabsTrigger value="customers">Clientes</TabsTrigger>
        </TabsList>

        {/* ===== Tab 1: Overview ===== */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Distribuicao por Segmento" loading={loading} isEmpty={segmentPieData.length === 0} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={segmentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={3}
                    label={({ name, value }) => `${name} (${value})`} labelLine={{ strokeWidth: 1 }}>
                    {segmentPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Receita por Segmento" loading={loading} isEmpty={revenueBySegmentData.length === 0} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBySegmentData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis type="number" stroke="#8888a0" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" stroke="#8888a0" fontSize={11} width={120} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number | undefined) => [formatCurrency(value ?? 0), "Receita"]} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {revenueBySegmentData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
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
        </TabsContent>

        {/* ===== Tab 2: Segments ===== */}
        <TabsContent value="segments" className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : segments.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem dados de segmentacao.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {segments.map((seg) => (
                <Card key={seg.segment} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => handleSegmentClick(seg.segment)}>
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
                    <Button
                      variant="outline" size="sm"
                      className="w-full mt-1 text-xs gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        const filtered = customers.filter((c) => c.segment === seg.segment);
                        exportCustomersCsv(filtered, `crm-${seg.label.toLowerCase().replace(/\s+/g, "-")}`);
                        logExport(`segment_${seg.segment}`, { segmento: seg.label }, filtered.length);
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Exportar CSV ({seg.customerCount})
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== Tab 3: Behavior ===== */}
        <TabsContent value="behavior" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Preferencia de Dia do Mes" loading={loading} isEmpty={behavioral.dayOfMonth.length === 0}
              actions={<ExportSelect customers={customers} filenamePrefix="crm-dia-mes" onExport={logExport}
                options={[{ value: "1-5", label: "Dia 1-5" }, { value: "6-10", label: "Dia 6-10" }, { value: "11-15", label: "Dia 11-15" }, { value: "16-20", label: "Dia 16-20" }, { value: "21-25", label: "Dia 21-25" }, { value: "26-31", label: "Dia 26-31" }]}
                filterFn={(c, v) => c.preferredDayRange === v} />}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.dayOfMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Turno Preferido" loading={loading} isEmpty={behavioral.hourOfDay.length === 0}
              actions={<ExportSelect customers={customers} filenamePrefix="crm-turno" onExport={logExport}
                options={[{ value: "madrugada", label: "Madrugada" }, { value: "manha", label: "Manha" }, { value: "tarde", label: "Tarde" }, { value: "noite", label: "Noite" }]}
                filterFn={(c, v) => c.preferredHour === v} />}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.hourOfDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Sensibilidade a Cupom" loading={loading} isEmpty={behavioral.couponUsage.length === 0}
              actions={<ExportSelect customers={customers} filenamePrefix="crm-cupom" onExport={logExport}
                options={[{ value: "never", label: "Nunca usa" }, { value: "occasional", label: "Ocasional" }, { value: "frequent", label: "Frequente" }, { value: "always", label: "Sempre usa" }]}
                filterFn={(c, v) => c.couponSensitivity === v} />}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={behavioral.couponUsage} dataKey="count" nameKey="bucket" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={3}
                    label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""} (${value ?? 0})`} labelLine={{ strokeWidth: 1 }}>
                    {behavioral.couponUsage.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Estagio do Ciclo de Vida" loading={loading} isEmpty={behavioral.lifecycle.length === 0}
              actions={<ExportSelect customers={customers} filenamePrefix="crm-lifecycle" onExport={logExport}
                options={[{ value: "new", label: "Novo" }, { value: "returning", label: "Retornante" }, { value: "regular", label: "Regular" }, { value: "vip", label: "VIP" }]}
                filterFn={(c, v) => c.lifecycleStage === v} />}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={behavioral.lifecycle}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="bucket" stroke="#8888a0" fontSize={12} tickLine={false} />
                  <YAxis stroke="#8888a0" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]}>
                    {behavioral.lifecycle.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard title="Dia da Semana Preferido" loading={loading} isEmpty={behavioral.weekday.length === 0}
            actions={<ExportSelect customers={customers} filenamePrefix="crm-dia-semana" onExport={logExport}
              options={[{ value: "seg", label: "Segunda" }, { value: "ter", label: "Terca" }, { value: "qua", label: "Quarta" }, { value: "qui", label: "Quinta" }, { value: "sex", label: "Sexta" }, { value: "sab", label: "Sabado" }, { value: "dom", label: "Domingo" }]}
              filterFn={(c, v) => c.preferredWeekday === v} />}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={behavioral.weekday}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                <XAxis dataKey="bucket" stroke="#8888a0" fontSize={12} tickLine={false} />
                <YAxis stroke="#8888a0" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Clientes" radius={[4, 4, 0, 0]}>
                  {(behavioral.weekday || []).map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>

        {/* ===== Tab 4: Customers ===== */}
        <TabsContent value="customers" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, email ou telefone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value as RfmSegment | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos os segmentos</option>
              {segments.map((seg) => (<option key={seg.segment} value={seg.segment}>{seg.label} ({seg.customerCount})</option>))}
            </select>
            <select value={dayRangeFilter} onChange={(e) => setDayRangeFilter(e.target.value as DayRange | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos os dias do mes</option>
              <option value="1-5">Dia 1-5</option>
              <option value="6-10">Dia 6-10</option>
              <option value="11-15">Dia 11-15</option>
              <option value="16-20">Dia 16-20</option>
              <option value="21-25">Dia 21-25</option>
              <option value="26-31">Dia 26-31</option>
            </select>
            <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value as LifecycleStage | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos os estagios</option>
              <option value="new">Novo (1 compra)</option>
              <option value="returning">Retornante (2-3)</option>
              <option value="regular">Regular (4-10)</option>
              <option value="vip">VIP (11+)</option>
            </select>
            <select value={hourFilter} onChange={(e) => setHourFilter(e.target.value as HourPref | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos os turnos</option>
              <option value="madrugada">Madrugada (0-6h)</option>
              <option value="manha">Manha (6-12h)</option>
              <option value="tarde">Tarde (12-18h)</option>
              <option value="noite">Noite (18-24h)</option>
            </select>
            <select value={couponFilter} onChange={(e) => setCouponFilter(e.target.value as CouponSensitivity | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos cupons</option>
              <option value="never">Nunca usa cupom</option>
              <option value="occasional">Cupom ocasional</option>
              <option value="frequent">Cupom frequente</option>
              <option value="always">Sempre usa cupom</option>
            </select>
            <select value={weekdayFilter} onChange={(e) => setWeekdayFilter(e.target.value as Weekday | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="all">Todos os dias</option>
              <option value="seg">Segunda</option>
              <option value="ter">Terca</option>
              <option value="qua">Quarta</option>
              <option value="qui">Quinta</option>
              <option value="sex">Sexta</option>
              <option value="sab">Sabado</option>
              <option value="dom">Domingo</option>
            </select>
            <Button
              variant="outline" size="sm"
              className="h-10 gap-1.5 ml-auto"
              onClick={() => {
                const filters: Record<string, string> = {};
                const parts: string[] = [];
                if (segmentFilter !== "all") { parts.push(SEGMENT_META[segmentFilter].label); filters.segmento = segmentFilter; }
                if (dayRangeFilter !== "all") { parts.push(`dia-${dayRangeFilter}`); filters.faixa_dia = dayRangeFilter; }
                if (lifecycleFilter !== "all") { parts.push(LIFECYCLE_META[lifecycleFilter].label); filters.lifecycle = lifecycleFilter; }
                if (hourFilter !== "all") { parts.push(HOUR_LABELS[hourFilter]); filters.turno = hourFilter; }
                if (couponFilter !== "all") { parts.push(COUPON_META[couponFilter].label); filters.cupom = couponFilter; }
                if (weekdayFilter !== "all") { parts.push(WEEKDAY_META[weekdayFilter].label); filters.dia_semana = weekdayFilter; }
                if (searchQuery) filters.busca = searchQuery;
                const suffix = parts.length > 0 ? parts.join("-").toLowerCase().replace(/[\s()]+/g, "").replace(/-+/g, "-") : "todos";
                exportCustomersCsv(filteredCustomers, `crm-clientes-${suffix}`);
                logExport("filtered_clients", filters, filteredCustomers.length);
              }}
            >
              <Download className="h-4 w-4" />
              Exportar CSV ({filteredCustomers.length})
            </Button>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
