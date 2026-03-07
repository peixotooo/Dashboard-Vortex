"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Image as ImageIcon,
  Eye,
  MousePointerClick,
  DollarSign,
  Target,
  TrendingUp,
  Users,
  Megaphone,
  Layers,
  ArrowUpDown,
  Video,
  Link2,
  Pause,
  ExternalLink,
  Trophy,
  Zap,
  BarChart3,
  Loader2,
  AlertTriangle,
  OctagonX,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { DatePreset, ActiveAdCreative } from "@/lib/types";

interface UrlGroup {
  url: string;
  adsCount: number;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpc: number;
}

const TIER_CONFIG = {
  champion: { label: "Escalar", icon: Trophy, className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  potential: { label: "Aumentar", icon: Zap, className: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  scale: { label: "Manter", icon: BarChart3, className: "text-purple-500 border-purple-500/30 bg-purple-500/10" },
  profitable: { label: "Otimizar", icon: TrendingUp, className: "text-cyan-500 border-cyan-500/30 bg-cyan-500/10" },
  warning: { label: "Revisar", icon: AlertTriangle, className: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  critical: { label: "Pausar", icon: OctagonX, className: "text-red-500 border-red-500/30 bg-red-500/10" },
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

export default function CreativesPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [ads, setAds] = useState<ActiveAdCreative[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{ total: number; loaded: number } | null>(null);
  const [selectedAd, setSelectedAd] = useState<ActiveAdCreative | null>(null);
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState("active");
  const [tierFilter, setTierFilter] = useState("all");
  const [pageAccountFilter, setPageAccountFilter] = useState("all");
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!accountId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const accountIds =
      accountId === "all" ? accounts.map((a) => a.id) : [accountId];
    const isMulti = accountIds.length > 1;

    setAds([]);
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
            `/api/creatives?account_id=${id}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
            { headers, signal: controller.signal }
          );
          const data = await res.json();
          const name = accounts.find((a) => a.id === id)?.name || id;
          const enriched = (data.ads || []).map((ad: ActiveAdCreative) => ({
            ...ad,
            account_id: id,
            account_name: name,
          }));

          setAds((prev) => [...prev, ...enriched]);
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
          `/api/creatives?account_id=${accountIds[0]}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
          { headers, signal: controller.signal }
        );
        const data = await res.json();
        setAds(data.ads || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setInitialLoading(false);
      }
    }
  }, [accountId, accounts, datePreset, workspace?.id]);

  useEffect(() => {
    fetchData();
    return () => { abortRef.current?.abort(); };
  }, [fetchData]);

  // Filter by page account
  const accountFilteredAds = useMemo(
    () =>
      pageAccountFilter === "all"
        ? ads
        : ads.filter((a) => a.account_id === pageAccountFilter),
    [ads, pageAccountFilter]
  );

  // Split by status
  const activeAds = useMemo(
    () => accountFilteredAds.filter((a) => a.status === "ACTIVE"),
    [accountFilteredAds]
  );
  const pausedWithResults = useMemo(
    () =>
      accountFilteredAds
        .filter((a) => a.status === "PAUSED" && a.spend > 0 && a.roas > 0)
        .sort((a, b) => b.roas - a.roas),
    [accountFilteredAds]
  );

  // URL grouping (from active ads only)
  const urlGroups = useMemo(() => {
    const map = new Map<string, UrlGroup>();
    for (const ad of activeAds) {
      if (!ad.destination_url) continue;
      const existing = map.get(ad.destination_url) || {
        url: ad.destination_url,
        adsCount: 0,
        impressions: 0,
        clicks: 0,
        spend: 0,
        revenue: 0,
        roas: 0,
        ctr: 0,
        cpc: 0,
      };
      existing.adsCount += 1;
      existing.impressions += ad.impressions;
      existing.clicks += ad.clicks;
      existing.spend += ad.spend;
      existing.revenue += ad.revenue;
      map.set(ad.destination_url, existing);
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        roas: g.spend > 0 ? g.revenue / g.spend : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
        cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [activeAds]);

  // Current dataset based on tab + tier filter
  const currentData = useMemo(() => {
    let data: ActiveAdCreative[] | UrlGroup[];
    if (activeTab === "paused") data = pausedWithResults;
    else if (activeTab === "urls") return urlGroups;
    else data = activeAds;

    // Apply tier filter
    if (tierFilter !== "all") {
      data = (data as ActiveAdCreative[]).filter((a) => a.tier === tierFilter);
    }
    return data;
  }, [activeTab, activeAds, pausedWithResults, urlGroups, tierFilter]);

  // Sorting
  const sortedData = useMemo(() => {
    return [...(currentData as Array<Record<string, unknown>>)].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      const aNum =
        typeof aVal === "number" ? aVal : parseFloat(String(aVal)) || 0;
      const bNum =
        typeof bVal === "number" ? bVal : parseFloat(String(bVal)) || 0;
      return sortDir === "desc" ? bNum - aNum : aNum - bNum;
    });
  }, [currentData, sortKey, sortDir]);

  // Tier counts
  const tierCounts = useMemo(() => {
    const dataset = activeTab === "paused" ? pausedWithResults : activeAds;
    return {
      champion: dataset.filter((a) => a.tier === "champion").length,
      potential: dataset.filter((a) => a.tier === "potential").length,
      scale: dataset.filter((a) => a.tier === "scale").length,
      profitable: dataset.filter((a) => a.tier === "profitable").length,
      warning: dataset.filter((a) => a.tier === "warning").length,
      critical: dataset.filter((a) => a.tier === "critical").length,
    };
  }, [activeTab, activeAds, pausedWithResults]);

  // KPI calculations — Investimento/ROAS/CTR always use ALL ads for consistency with campaigns page
  const kpis = useMemo(() => {
    const totalSpend = accountFilteredAds.reduce((s, a) => s + a.spend, 0);
    const totalRevenue = accountFilteredAds.reduce((s, a) => s + a.revenue, 0);
    const totalImpressions = accountFilteredAds.reduce((s, a) => s + a.impressions, 0);
    const totalClicks = accountFilteredAds.reduce((s, a) => s + a.clicks, 0);
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Card 1 is tab-specific (count)
    let card1;
    if (activeTab === "urls") {
      card1 = { title: "URLs Unicas", value: formatNumber(urlGroups.length), icon: Link2, color: "text-blue-400" };
    } else if (activeTab === "paused") {
      card1 = { title: "Criativos Pausados", value: formatNumber(pausedWithResults.length), icon: Pause, color: "text-yellow-400" };
    } else {
      card1 = { title: "Criativos Ativos", value: formatNumber(activeAds.length), icon: ImageIcon, color: "text-blue-400" };
    }

    return {
      card1,
      card2: { title: "Investimento", value: formatCurrency(totalSpend), icon: DollarSign, color: "text-success" },
      card3: { title: "ROAS Medio", value: `${avgRoas.toFixed(2)}x`, icon: Target, color: "text-purple-400" },
      card4: { title: "CTR Medio", value: formatPercent(avgCtr), icon: MousePointerClick, color: "text-warning" },
    };
  }, [activeTab, activeAds, pausedWithResults, urlGroups, accountFilteredAds]);

  const formatFormat = (format: string) => {
    switch (format) {
      case "video":
        return "Video";
      case "carousel":
        return "Carrossel";
      case "image":
        return "Imagem";
      default:
        return "Outro";
    }
  };

  // Columns for Ativos and Pausados tabs
  const adColumns = [
    {
      key: "thumbnail_url",
      label: "",
      render: (val: unknown, row: Record<string, unknown>) => (
        <div className="w-12 h-12 rounded overflow-hidden bg-muted flex-shrink-0">
          {val || row.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(val || row.image_url)}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : row.video_id ? (
            <div className="w-full h-full flex items-center justify-center">
              <Video className="h-4 w-4 text-muted-foreground" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ),
    },
    {
      key: "ad_name",
      label: "Criativo",
      render: (val: unknown, row: Record<string, unknown>) => (
        <div className="max-w-[220px]">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{String(val)}</p>
            <TierBadge tier={row.tier as string} />
          </div>
          {row.body ? (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {String(row.body).slice(0, 80)}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "campaign_name", label: "Campanha" },
    // Account column (only in multi-account mode)
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
      key: "format",
      label: "Formato",
      render: (val: unknown) => (
        <Badge variant="secondary" className="text-xs">
          {formatFormat(String(val))}
        </Badge>
      ),
    },
    ...(activeTab === "paused"
      ? [
          {
            key: "status",
            label: "Status",
            render: () => (
              <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
                Pausado
              </Badge>
            ),
          },
        ]
      : []),
    {
      key: "impressions",
      label: "Impressoes",
      format: "number" as const,
      align: "right" as const,
    },
    { key: "clicks", label: "Cliques", format: "number" as const, align: "right" as const },
    { key: "ctr", label: "CTR", format: "percent" as const, align: "right" as const },
    { key: "cpc", label: "CPC", format: "currency" as const, align: "right" as const },
    {
      key: "spend",
      label: "Investimento",
      format: "currency" as const,
      align: "right" as const,
    },
    {
      key: "revenue",
      label: "Receita",
      format: "currency" as const,
      align: "right" as const,
    },
    {
      key: "roas",
      label: "ROAS",
      align: "right" as const,
      render: (val: unknown) => (
        <span className="font-medium">
          {Number(val || 0).toFixed(2)}x
        </span>
      ),
    },
  ];

  // Columns for URL tab
  const urlColumns = [
    {
      key: "url",
      label: "URL de Destino",
      render: (val: unknown) => {
        const url = String(val);
        let display = url;
        try {
          const parsed = new URL(url);
          display = parsed.pathname === "/" ? parsed.hostname : parsed.hostname + parsed.pathname;
        } catch {
          // keep as-is
        }
        return (
          <div className="flex items-center gap-2 max-w-[300px]">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-sm truncate" title={url}>{display}</span>
          </div>
        );
      },
    },
    { key: "adsCount", label: "Anuncios", format: "number" as const, align: "right" as const },
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
        <span className="font-medium">
          {Number(val || 0).toFixed(2)}x
        </span>
      ),
    },
  ];

  const tableTitle = activeTab === "active"
    ? "Performance por Criativo"
    : activeTab === "paused"
    ? "Criativos Pausados com Resultado"
    : "Performance por URL de Destino";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Criativos</h1>
          <p className="text-sm text-muted-foreground">
            Performance dos criativos de campanhas
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setTierFilter("all"); }}>
        <TabsList>
          <TabsTrigger value="active">Ativos</TabsTrigger>
          <TabsTrigger value="paused">Pausados com Resultado</TabsTrigger>
          <TabsTrigger value="urls">Por URL de Destino</TabsTrigger>
        </TabsList>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <KpiCard
            title={kpis.card1.title}
            value={kpis.card1.value}
            icon={kpis.card1.icon}
            iconColor={kpis.card1.color}
            loading={initialLoading}
          />
          <KpiCard
            title={kpis.card2.title}
            value={kpis.card2.value}
            icon={kpis.card2.icon}
            iconColor={kpis.card2.color}
            loading={initialLoading}
            badge="Meta"
            badgeColor="#1877f2"
          />
          <KpiCard
            title={kpis.card3.title}
            value={kpis.card3.value}
            icon={kpis.card3.icon}
            iconColor={kpis.card3.color}
            loading={initialLoading}
          />
          <KpiCard
            title={kpis.card4.title}
            value={kpis.card4.value}
            icon={kpis.card4.icon}
            iconColor={kpis.card4.color}
            loading={initialLoading}
          />
        </div>

        {/* Loading Progress */}
        {loadingProgress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
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

        {/* Sort + Tier Filter controls */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
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
              {activeTab === "urls" && (
                <SelectItem value="adsCount">Anuncios</SelectItem>
              )}
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

          {/* Tier filter (not on URLs tab) */}
          {activeTab !== "urls" && (
            <>
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
            </>
          )}
        </div>

        {/* Tab Content */}
        <TabsContent value="active">
          <PerformanceTable
            title={tableTitle}
            columns={adColumns}
            data={sortedData as Array<Record<string, unknown>>}
            loading={initialLoading}
            onRowClick={(row) => setSelectedAd(row as unknown as ActiveAdCreative)}
          />
        </TabsContent>

        <TabsContent value="paused">
          {!initialLoading && !loadingProgress && pausedWithResults.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Pause className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Nenhum criativo pausado com resultados encontrado no periodo
                </p>
              </CardContent>
            </Card>
          ) : (
            <PerformanceTable
              title={tableTitle}
              columns={adColumns}
              data={sortedData as Array<Record<string, unknown>>}
              loading={initialLoading}
              onRowClick={(row) => setSelectedAd(row as unknown as ActiveAdCreative)}
            />
          )}
        </TabsContent>

        <TabsContent value="urls">
          {!initialLoading && !loadingProgress && urlGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Link2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma URL de destino encontrada nos criativos ativos
                </p>
              </CardContent>
            </Card>
          ) : (
            <PerformanceTable
              title={tableTitle}
              columns={urlColumns}
              data={sortedData as Array<Record<string, unknown>>}
              loading={initialLoading}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!selectedAd} onOpenChange={() => setSelectedAd(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedAd && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedAd.ad_name}
                  <TierBadge tier={selectedAd.tier} />
                </DialogTitle>
                <DialogDescription>
                  {selectedAd.account_name ? (
                    <>Conta: {selectedAd.account_name} | </>
                  ) : null}
                  Campanha: {selectedAd.campaign_name} | Conjunto:{" "}
                  {selectedAd.adset_name}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {/* Left Column - Preview */}
                <div className="space-y-4">
                  {selectedAd.image_url || selectedAd.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedAd.image_url || selectedAd.thumbnail_url}
                      alt={selectedAd.ad_name}
                      className="w-full rounded-lg border border-border object-cover max-h-[300px]"
                    />
                  ) : (
                    <div className="w-full h-48 rounded-lg bg-muted flex items-center justify-center border border-border">
                      {selectedAd.video_id ? (
                        <Video className="h-12 w-12 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-12 w-12 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {selectedAd.title && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Titulo
                      </p>
                      <p className="text-sm font-medium">{selectedAd.title}</p>
                    </div>
                  )}
                  {selectedAd.body && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Copy</p>
                      <p className="text-sm leading-relaxed">
                        {selectedAd.body}
                      </p>
                    </div>
                  )}
                  {selectedAd.destination_url && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">URL de Destino</p>
                      <p className="text-sm text-primary truncate">
                        {selectedAd.destination_url}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedAd.cta && (
                      <Badge variant="secondary">
                        {selectedAd.cta.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {formatFormat(selectedAd.format)}
                    </Badge>
                    {selectedAd.status === "PAUSED" && (
                      <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
                        Pausado
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Right Column - Info & Metrics */}
                <div className="space-y-5">
                  {/* Campaign Info */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      Vinculacao
                    </h3>
                    <div className="rounded-lg border border-border p-3 space-y-1.5">
                      {selectedAd.account_name && (
                        <div className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Conta:</span>
                          <span className="text-sm font-medium truncate">{selectedAd.account_name}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Campanha:
                        </span>
                        <span className="text-sm font-medium truncate">
                          {selectedAd.campaign_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Conjunto:
                        </span>
                        <span className="text-sm font-medium truncate">
                          {selectedAd.adset_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      Performance
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <MetricCard
                        icon={Eye}
                        label="Impressoes"
                        value={formatNumber(selectedAd.impressions)}
                      />
                      <MetricCard
                        icon={MousePointerClick}
                        label="Cliques"
                        value={formatNumber(selectedAd.clicks)}
                      />
                      <MetricCard
                        icon={DollarSign}
                        label="Investimento"
                        value={formatCurrency(selectedAd.spend)}
                      />
                      <MetricCard
                        icon={Users}
                        label="Alcance"
                        value={formatNumber(selectedAd.reach)}
                      />
                      <MetricCard
                        icon={Target}
                        label="CTR"
                        value={formatPercent(selectedAd.ctr)}
                      />
                      <MetricCard
                        icon={TrendingUp}
                        label="CPC"
                        value={formatCurrency(selectedAd.cpc)}
                      />
                      <MetricCard
                        icon={DollarSign}
                        label="Receita"
                        value={formatCurrency(selectedAd.revenue)}
                      />
                      <MetricCard
                        icon={Target}
                        label="ROAS"
                        value={`${selectedAd.roas.toFixed(2)}x`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
