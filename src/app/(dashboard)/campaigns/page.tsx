"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Plus,
  Pause,
  Play,
  Trash2,
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
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBudget, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
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

export default function CampaignsPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{ total: number; loaded: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tierFilter, setTierFilter] = useState("all");
  const [pageAccountFilter, setPageAccountFilter] = useState("all");
  const abortRef = useRef<AbortController | null>(null);

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const accountIds =
      accountId === "all" ? accounts.map((a) => a.id) : [accountId];
    const isMulti = accountIds.length > 1;

    setCampaigns([]);
    setInitialLoading(true);
    setPageAccountFilter("all");
    setLoadingProgress(isMulti ? { total: accountIds.length, loaded: 0 } : null);

    const headers: Record<string, string> = {};
    if (workspace?.id) {
      headers["x-workspace-id"] = workspace.id;
    }

    if (isMulti) {
      const promises = accountIds.map(async (id) => {
        try {
          const res = await fetch(
            `/api/campaigns?account_id=${id}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
            { headers, signal: controller.signal }
          );
          const data = await res.json();
          const name = accounts.find((a) => a.id === id)?.name || id;
          const enriched = (data.campaigns || []).map((c: CampaignWithMetrics) => ({
            ...c,
            account_id: id,
            account_name: name,
          }));

          setCampaigns((prev) => [...prev, ...enriched]);
          setInitialLoading(false);
          setLoadingProgress((prev) =>
            prev ? { ...prev, loaded: prev.loaded + 1 } : null
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoadingProgress((prev) =>
            prev ? { ...prev, loaded: prev.loaded + 1 } : null
          );
        }
      });

      await Promise.all(promises);
      setLoadingProgress(null);
      setInitialLoading(false);
    } else {
      try {
        const res = await fetch(
          `/api/campaigns?account_id=${accountIds[0]}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
          { headers, signal: controller.signal }
        );
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setInitialLoading(false);
      }
    }
  }, [accountId, accounts, datePreset, workspace?.id]);

  useEffect(() => {
    fetchCampaigns();
    return () => { abortRef.current?.abort(); };
  }, [fetchCampaigns]);

  async function handleAction(action: string, campaignId: string) {
    setActionLoading(campaignId);
    try {
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaign_id: campaignId }),
      });
      await fetchCampaigns();
    } catch {
      // Error handling
    } finally {
      setActionLoading(null);
    }
  }

  // Filter by page account
  const accountFiltered = useMemo(
    () =>
      pageAccountFilter === "all"
        ? campaigns
        : campaigns.filter((c) => c.account_id === pageAccountFilter),
    [campaigns, pageAccountFilter]
  );

  // Filter by name
  const filtered = useMemo(
    () =>
      accountFiltered.filter((c) =>
        c.name?.toLowerCase().includes(filter.toLowerCase())
      ),
    [accountFiltered, filter]
  );

  // Filter by tier
  const tierFiltered = useMemo(
    () =>
      tierFilter === "all"
        ? filtered
        : filtered.filter((c) => c.tier === tierFilter),
    [filtered, tierFilter]
  );

  // Sorting — ACTIVE first, then by user-chosen sort key
  const sorted = useMemo(() => {
    return [...tierFiltered].sort((a, b) => {
      // Primary: ACTIVE before PAUSED
      const aActive = a.status === "ACTIVE" ? 0 : 1;
      const bActive = b.status === "ACTIVE" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      // Secondary: user-chosen sort key
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
        <div className="max-w-[250px]">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{String(val)}</p>
            <TierBadge tier={row.tier as string} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {String(row.objective || "").replace("OUTCOME_", "")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      format: "status" as const,
    },
    // Account column (multi-account only)
    ...(accountId === "all"
      ? [
          {
            key: "account_name",
            label: "Conta",
            render: (val: unknown) => (
              <Badge variant="outline" className="text-xs">
                {String(val || "")}
              </Badge>
            ),
          },
        ]
      : []),
    {
      key: "daily_budget",
      label: "Orcamento",
      align: "right" as const,
      render: (_val: unknown, row: Record<string, unknown>) => (
        <span className="text-sm">
          {row.daily_budget
            ? `${formatBudget(String(row.daily_budget))}/dia`
            : row.lifetime_budget
            ? formatBudget(String(row.lifetime_budget))
            : "-"}
        </span>
      ),
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
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Performance e gestao de campanhas Meta Ads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={datePreset} onChange={setDatePreset} />
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4 mr-2" />
              Nova Campanha
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Campanhas"
          value={formatNumber(totalCampaigns)}
          icon={Megaphone}
          iconColor="text-blue-400"
          loading={initialLoading}
        />
        <KpiCard
          title="Investimento"
          value={formatCurrency(totalSpend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={initialLoading}
          badge="Meta"
          badgeColor="#1877f2"
        />
        <KpiCard
          title="ROAS Medio"
          value={`${avgRoas.toFixed(2)}x`}
          icon={Target}
          iconColor="text-purple-400"
          loading={initialLoading}
        />
        <KpiCard
          title="CTR Medio"
          value={formatPercent(avgCtr)}
          icon={MousePointerClick}
          iconColor="text-warning"
          loading={initialLoading}
        />
      </div>

      {/* Loading Progress */}
      {loadingProgress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Carregando... ({loadingProgress.loaded}/{loadingProgress.total} contas)</span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-[200px]">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Account Filter (multi-account only) */}
        {accountId === "all" && accounts.length > 1 && (
          <>
            <Select value={pageAccountFilter} onValueChange={setPageAccountFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-px h-6 bg-border mx-1" />
          </>
        )}

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
      <PerformanceTable
        title={`${sorted.length} campanha${sorted.length !== 1 ? "s" : ""}`}
        columns={columns}
        data={sorted as unknown as Array<Record<string, unknown>>}
        loading={initialLoading}
        actions={(row) => {
          const status = row.status as string;
          const id = row.id as string;
          return (
            <div className="flex items-center justify-end gap-1">
              {status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction("pause", id);
                  }}
                  disabled={actionLoading === id}
                  title="Pausar"
                >
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              ) : status === "PAUSED" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction("resume", id);
                  }}
                  disabled={actionLoading === id}
                  title="Retomar"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction("delete", id);
                }}
                disabled={actionLoading === id}
                title="Deletar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }}
      />

      {/* Empty state */}
      {!initialLoading && !loadingProgress && sorted.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha encontrada
            </p>
          </CardContent>
        </Card>
      )}
    </div>
    </TooltipProvider>
  );
}
