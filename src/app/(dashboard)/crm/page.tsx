"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Users,
  DollarSign,
  CircleDollarSign,
  UserCheck,
  Search,
  Loader2,
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
import { formatCurrency, formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import type { RfmCustomer, RfmSegmentSummary, RfmSegment, CrmRfmResponse } from "@/lib/crm-rfm";
import { SEGMENT_META } from "@/lib/crm-rfm";

// --- Constants ---

const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

const emptySummary: CrmRfmResponse["summary"] = {
  totalCustomers: 0,
  totalRevenue: 0,
  avgTicket: 0,
  activeCustomers: 0,
  avgPurchasesPerCustomer: 0,
  medianRecency: 0,
};

const emptyDistributions: CrmRfmResponse["distributions"] = {
  recency: [],
  frequency: [],
  monetary: [],
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

// --- Page ---

export default function CrmPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<RfmSegment | "all">("all");
  const [activeTab, setActiveTab] = useState("overview");

  const [customers, setCustomers] = useState<RfmCustomer[]>([]);
  const [segments, setSegments] = useState<RfmSegmentSummary[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [distributions, setDistributions] = useState(emptyDistributions);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const hdrs: Record<string, string> = {};
      if (workspace?.id) hdrs["x-workspace-id"] = workspace.id;

      const res = await fetch("/api/crm/rfm", { headers: hdrs });
      const data = await res.json();

      setCustomers(data.customers || []);
      setSegments(data.segments || []);
      setSummary(data.summary || emptySummary);
      setDistributions(data.distributions || emptyDistributions);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    let list = customers;
    if (segmentFilter !== "all") {
      list = list.filter((c) => c.segment === segmentFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }
    return list;
  }, [customers, segmentFilter, searchQuery]);

  // Pie chart data
  const segmentPieData = useMemo(() => {
    return segments
      .filter((s) => s.customerCount > 0)
      .map((s) => ({
        name: s.label,
        value: s.customerCount,
        color: s.color,
      }));
  }, [segments]);

  // Revenue by segment bar chart
  const revenueBySegmentData = useMemo(() => {
    return [...segments]
      .filter((s) => s.totalRevenue > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map((s) => ({
        name: s.label,
        revenue: s.totalRevenue,
        color: s.color,
      }));
  }, [segments]);

  // Handle segment card click
  const handleSegmentClick = (segment: RfmSegment) => {
    setSegmentFilter(segment);
    setActiveTab("customers");
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CRM — Segmentacao RFM</h1>
        <p className="text-muted-foreground text-sm">
          Analise de clientes por Recencia, Frequencia e Valor Monetario para comunicacoes personalizadas
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          title="Total Clientes"
          value={formatNumber(summary.totalCustomers)}
          icon={Users}
          iconColor="text-purple-400"
          loading={loading}
        />
        <KpiCard
          title="Ticket Medio"
          value={formatCurrency(summary.avgTicket)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
        />
        <KpiCard
          title="Receita Total"
          value={formatCurrency(summary.totalRevenue)}
          icon={CircleDollarSign}
          iconColor="text-blue-400"
          loading={loading}
        />
        <KpiCard
          title="Clientes Ativos"
          value={formatNumber(summary.activeCustomers)}
          icon={UserCheck}
          iconColor="text-orange-400"
          loading={loading}
          badge="90 dias"
          badgeColor="#f97316"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Visao Geral</TabsTrigger>
          <TabsTrigger value="segments">Segmentos RFM</TabsTrigger>
          <TabsTrigger value="customers">Clientes</TabsTrigger>
        </TabsList>

        {/* ===== Tab 1: Overview ===== */}
        <TabsContent value="overview" className="space-y-6">
          {/* Charts Row 1: Pie + Revenue by Segment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Segment Distribution Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuicao por Segmento</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : segmentPieData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={segmentPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          innerRadius={50}
                          paddingAngle={3}
                          label={({ name, value }) => `${name} (${value})`}
                          labelLine={{ strokeWidth: 1 }}
                        >
                          {segmentPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revenue by Segment Bar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receita por Segmento</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : revenueBySegmentData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revenueBySegmentData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis
                          type="number"
                          stroke="#8888a0"
                          fontSize={12}
                          tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          stroke="#8888a0"
                          fontSize={11}
                          width={120}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(value: number | undefined) => [formatCurrency(value ?? 0), "Receita"]}
                        />
                        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                          {revenueBySegmentData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2: Recency + Frequency Distributions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recency Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuicao de Recencia</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[250px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : distributions.recency.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={distributions.recency}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis stroke="#8888a0" fontSize={12} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" name="Clientes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Frequency Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuicao de Frequencia</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-[250px] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : distributions.frequency.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                    Sem dados
                  </div>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={distributions.frequency}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                        <XAxis dataKey="bucket" stroke="#8888a0" fontSize={11} tickLine={false} />
                        <YAxis stroke="#8888a0" fontSize={12} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" name="Clientes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== Tab 2: Segments ===== */}
        <TabsContent value="segments" className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : segments.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Sem dados de segmentacao.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {segments.map((seg) => (
                <Card
                  key={seg.segment}
                  className="hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => handleSegmentClick(seg.segment)}
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: seg.color }}
                      />
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
        </TabsContent>

        {/* ===== Tab 3: Customers ===== */}
        <TabsContent value="customers" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, email ou telefone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value as RfmSegment | "all")}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">Todos os segmentos</option>
              {segments.map((seg) => (
                <option key={seg.segment} value={seg.segment}>
                  {seg.label} ({seg.customerCount})
                </option>
              ))}
            </select>
          </div>

          <PerformanceTable
            title={`Clientes (${filteredCustomers.length})`}
            sortable
            columns={[
              { key: "name", label: "Nome" },
              { key: "email", label: "Email" },
              {
                key: "totalPurchases",
                label: "Compras",
                format: "number",
                align: "right",
              },
              {
                key: "totalSpent",
                label: "Total Gasto",
                format: "currency",
                align: "right",
              },
              {
                key: "avgTicket",
                label: "Ticket",
                format: "currency",
                align: "right",
              },
              {
                key: "lastPurchaseDate",
                label: "Ultima Compra",
                align: "center",
              },
              {
                key: "daysSinceLastPurchase",
                label: "Dias",
                align: "right",
                render: (v) => {
                  const days = Number(v);
                  const color =
                    days <= 30
                      ? "text-success"
                      : days <= 90
                        ? "text-yellow-400"
                        : "text-destructive";
                  return <span className={`font-medium ${color}`}>{days >= 9999 ? "—" : days}</span>;
                },
              },
              {
                key: "rfmScore",
                label: "RFM",
                align: "center",
                render: (v) => <RfmScoreBadge score={String(v)} />,
              },
              {
                key: "segment",
                label: "Segmento",
                align: "center",
                render: (v) => <SegmentBadge segment={v as RfmSegment} />,
              },
            ]}
            data={filteredCustomers as unknown as Record<string, unknown>[]}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
