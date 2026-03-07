"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  champion: { label: "Campeao", icon: Trophy, className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  potential: { label: "Potencial", icon: Zap, className: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  scale: { label: "Escala", icon: BarChart3, className: "text-purple-500 border-purple-500/30 bg-purple-500/10" },
} as const;

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier || !(tier in TIER_CONFIG)) return null;
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export default function CampaignsPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tierFilter, setTierFilter] = useState("all");

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const accountIds =
        accountId === "all" ? accounts.map((a) => a.id) : [accountId];

      const headers: Record<string, string> = {};
      if (workspace?.id) {
        headers["x-workspace-id"] = workspace.id;
      }

      const results = await Promise.all(
        accountIds.map(async (id) => {
          const res = await fetch(
            `/api/campaigns?account_id=${id}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
            { headers }
          );
          const data = await res.json();
          if (accountId === "all") {
            const name = accounts.find((a) => a.id === id)?.name || id;
            return (data.campaigns || []).map((c: CampaignWithMetrics) => ({
              ...c,
              account_id: id,
              account_name: name,
            }));
          }
          return data.campaigns || [];
        })
      );

      const allCampaigns: CampaignWithMetrics[] = results.flat();
      setCampaigns(allCampaigns);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [accountId, accounts, datePreset, workspace?.id]);

  useEffect(() => {
    fetchCampaigns();
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
          loading={loading}
        />
        <KpiCard
          title="Investimento"
          value={formatCurrency(totalSpend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          badge="Meta"
          badgeColor="#1877f2"
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

        <span className="text-xs text-muted-foreground">Classificacao:</span>
        <div className="flex items-center gap-1">
          <Button
            variant={tierFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTierFilter("all")}
          >
            Todos
          </Button>
          <Button
            variant={tierFilter === "champion" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => setTierFilter("champion")}
          >
            <Trophy className="h-3 w-3 text-emerald-500" />
            Campeoes {tierCounts.champion > 0 && `(${tierCounts.champion})`}
          </Button>
          <Button
            variant={tierFilter === "potential" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => setTierFilter("potential")}
          >
            <Zap className="h-3 w-3 text-blue-500" />
            Potencial {tierCounts.potential > 0 && `(${tierCounts.potential})`}
          </Button>
          <Button
            variant={tierFilter === "scale" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => setTierFilter("scale")}
          >
            <BarChart3 className="h-3 w-3 text-purple-500" />
            Escala {tierCounts.scale > 0 && `(${tierCounts.scale})`}
          </Button>
        </div>
      </div>

      {/* Performance Table */}
      <PerformanceTable
        title={`${sorted.length} campanha${sorted.length !== 1 ? "s" : ""}`}
        columns={columns}
        data={sorted as unknown as Array<Record<string, unknown>>}
        loading={loading}
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
      {!loading && sorted.length === 0 && (
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
  );
}
