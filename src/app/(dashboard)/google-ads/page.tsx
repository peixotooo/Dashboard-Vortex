"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Megaphone,
  DollarSign,
  Target,
  MousePointerClick,
  ArrowUpDown,
  Trophy,
  Zap,
  BarChart3,
  Loader2,
  TrendingUp,
  AlertTriangle,
  OctagonX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { DatePreset, CampaignWithMetrics } from "@/lib/types";

const TIER_CONFIG = {
  champion: { label: "Escalar", description: "ROAS acima de 1.5x a media e alto investimento. Aumente o budget — esta gerando muito retorno com volume.", icon: Trophy, className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  potential: { label: "Aumentar", description: "ROAS acima de 1.5x a media, mas investimento baixo. Suba o budget para capturar mais resultado com esse ROAS alto.", icon: Zap, className: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  scale: { label: "Manter", description: "Alto investimento com retorno positivo (ROAS >= 1.0). Mantenha o budget atual e monitore variacoes.", icon: BarChart3, className: "text-purple-500 border-purple-500/30 bg-purple-500/10" },
  profitable: { label: "Otimizar", description: "ROAS positivo mas abaixo da media. Teste novos criativos, copys ou publicos para melhorar o retorno.", icon: TrendingUp, className: "text-cyan-500 border-cyan-500/30 bg-cyan-500/10" },
  warning: { label: "Revisar", description: "ROAS abaixo de 1.0 — gasta mais do que retorna. Revise segmentacao, criativos e landing page urgente.", icon: AlertTriangle, className: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  critical: { label: "Pausar", description: "Investimento sem nenhum retorno (ROAS zero). Pause imediatamente e reestruture antes de gastar mais.", icon: OctagonX, className: "text-red-500 border-red-500/30 bg-red-500/10" },
} as const;

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier || !(tier in TIER_CONFIG)) return null;
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];
  const Icon = config.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-xs gap-1 cursor-help ${config.className}`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-xs">
        {config.description}
      </TooltipContent>
    </Tooltip>
  );
}

export default function GoogleAdsPage() {
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tierFilter, setTierFilter] = useState("all");
  const abortRef = useRef<AbortController | null>(null);

  const fetchCampaigns = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setCampaigns([]);
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    if (workspace?.id) {
      headers["x-workspace-id"] = workspace.id;
    }

    try {
      const res = await fetch(
        `/api/google-ads/campaigns?date_preset=${datePreset}`,
        { headers, signal: controller.signal }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Erro ao carregar campanhas");
    } finally {
      setLoading(false);
    }
  }, [datePreset, workspace?.id]);

  useEffect(() => {
    fetchCampaigns();
    return () => { abortRef.current?.abort(); };
  }, [fetchCampaigns]);

  // Filter by name
  const filtered = useMemo(
    () =>
      campaigns.filter((c) =>
        c.name?.toLowerCase().includes(filter.toLowerCase())
      ),
    [campaigns, filter]
  );

  // Filter by tier
  const tierFiltered = useMemo(
    () =>
      tierFilter === "all"
        ? filtered
        : filtered.filter((c) => c.tier === tierFilter),
    [filtered, tierFilter]
  );

  // Sorting
  const sorted = useMemo(() => {
    return [...tierFiltered].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey] ?? 0;
      const bVal = (b as unknown as Record<string, unknown>)[sortKey] ?? 0;
      const aNum = typeof aVal === "number" ? aVal : parseFloat(String(aVal)) || 0;
      const bNum = typeof bVal === "number" ? bVal : parseFloat(String(bVal)) || 0;
      return sortDir === "desc" ? bNum - aNum : aNum - bNum;
    });
  }, [tierFiltered, sortKey, sortDir]);

  // Tier counts
  const tierCounts = useMemo(() => ({
    champion: filtered.filter((c) => c.tier === "champion").length,
    potential: filtered.filter((c) => c.tier === "potential").length,
    scale: filtered.filter((c) => c.tier === "scale").length,
    profitable: filtered.filter((c) => c.tier === "profitable").length,
    warning: filtered.filter((c) => c.tier === "warning").length,
    critical: filtered.filter((c) => c.tier === "critical").length,
  }), [filtered]);

  // KPIs
  const totalCampaigns = filtered.length;
  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.revenue, 0);
  const totalImpressions = filtered.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.clicks, 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const columns = [
    {
      key: "name",
      label: "Campanha",
      render: (val: unknown, row: Record<string, unknown>) => (
        <div className="max-w-[280px]">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{String(val)}</p>
            <TierBadge tier={row.tier as string} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {String(row.objective || "")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      format: "status" as const,
    },
    { key: "impressions", label: "Impressoes", format: "number" as const, align: "right" as const },
    { key: "clicks", label: "Cliques", format: "number" as const, align: "right" as const },
    { key: "ctr", label: "CTR", format: "percent" as const, align: "right" as const },
    { key: "cpc", label: "CPC", format: "currency" as const, align: "right" as const },
    { key: "spend", label: "Investimento", format: "currency" as const, align: "right" as const },
    { key: "revenue", label: "Receita", format: "currency" as const, align: "right" as const },
    {
      key: "roas",
      label: "ROAS",
      align: "right" as const,
      render: (val: unknown) => (
        <span className="font-medium">{Number(val || 0).toFixed(2)}x</span>
      ),
    },
  ];

  return (
    <TooltipProvider>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Google Ads</h1>
          <p className="text-sm text-muted-foreground">
            Performance e classificacao de campanhas Google Ads
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* Error state */}
      {error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Verifique se as credenciais do Google Ads estao configuradas no .env.local
            </p>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Campanhas"
          value={formatNumber(totalCampaigns)}
          icon={Megaphone}
          iconColor="text-blue-400"
          loading={loading}
        />
        <KpiCard
          title="Investimento"
          value={formatCurrency(totalSpend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          badge="Google"
          badgeColor="#4285f4"
        />
        <KpiCard
          title="ROAS Medio"
          value={`${avgRoas.toFixed(2)}x`}
          icon={Target}
          iconColor="text-purple-400"
          loading={loading}
        />
        <KpiCard
          title="CTR Medio"
          value={formatPercent(avgCtr)}
          icon={MousePointerClick}
          iconColor="text-warning"
          loading={loading}
        />
      </div>

      {/* Controls Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Buscar campanhas..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-48 h-8 text-xs"
        />

        <div className="w-px h-6 bg-border mx-1" />

        <span className="text-xs text-muted-foreground">Ordenar por:</span>
        <Select value={sortKey} onValueChange={setSortKey}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spend">Investimento</SelectItem>
            <SelectItem value="roas">ROAS</SelectItem>
            <SelectItem value="revenue">Receita</SelectItem>
            <SelectItem value="ctr">CTR</SelectItem>
            <SelectItem value="impressions">Impressoes</SelectItem>
            <SelectItem value="clicks">Cliques</SelectItem>
            <SelectItem value="cpc">CPC</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <span className="text-xs text-muted-foreground">Acao:</span>
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant={tierFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTierFilter("all")}
          >
            Todos
          </Button>
          {(Object.keys(TIER_CONFIG) as Array<keyof typeof TIER_CONFIG>).map((key) => {
            const config = TIER_CONFIG[key];
            const Icon = config.icon;
            const count = tierCounts[key] || 0;
            return (
              <Button
                key={key}
                variant={tierFilter === key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2 gap-1"
                onClick={() => setTierFilter(key)}
              >
                <Icon className={`h-3 w-3 ${config.className.split(" ")[0]}`} />
                {config.label} {count > 0 && `(${count})`}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Tier description when filter is active */}
      {tierFilter !== "all" && tierFilter in TIER_CONFIG && (
        <p className="text-xs text-muted-foreground -mt-4">
          {TIER_CONFIG[tierFilter as keyof typeof TIER_CONFIG].description}
        </p>
      )}

      {/* Performance Table */}
      {!error && (
        <PerformanceTable
          title={`${sorted.length} campanha${sorted.length !== 1 ? "s" : ""}`}
          columns={columns}
          data={sorted as unknown as Array<Record<string, unknown>>}
          loading={loading}
        />
      )}

      {/* Empty state */}
      {!loading && !error && sorted.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha Google Ads encontrada
            </p>
          </CardContent>
        </Card>
      )}
    </div>
    </TooltipProvider>
  );
}
