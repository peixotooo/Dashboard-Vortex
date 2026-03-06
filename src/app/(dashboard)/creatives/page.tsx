"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function CreativesPage() {
  const { accountId, accounts } = useAccount();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [ads, setAds] = useState<ActiveAdCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<ActiveAdCreative | null>(null);
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState("active");

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const accountIds =
        accountId === "all" ? accounts.map((a) => a.id) : [accountId];

      const results = await Promise.all(
        accountIds.map((id) =>
          fetch(
            `/api/creatives?account_id=${id}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`
          ).then((r) => r.json())
        )
      );

      const allAds: ActiveAdCreative[] = results.flatMap((r) => r.ads || []);
      setAds(allAds);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [accountId, accounts, datePreset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Split by status
  const activeAds = useMemo(
    () => ads.filter((a) => a.status === "ACTIVE"),
    [ads]
  );
  const pausedWithResults = useMemo(
    () =>
      ads
        .filter((a) => a.status === "PAUSED" && a.spend > 0 && a.roas > 0)
        .sort((a, b) => b.roas - a.roas),
    [ads]
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

  // Current dataset based on tab
  const currentData = useMemo(() => {
    if (activeTab === "paused") return pausedWithResults;
    if (activeTab === "urls") return urlGroups;
    return activeAds;
  }, [activeTab, activeAds, pausedWithResults, urlGroups]);

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

  // KPI calculations per tab
  const kpis = useMemo(() => {
    if (activeTab === "urls") {
      const totalSpend = urlGroups.reduce((s, g) => s + g.spend, 0);
      const totalRevenue = urlGroups.reduce((s, g) => s + g.revenue, 0);
      const totalImpressions = urlGroups.reduce((s, g) => s + g.impressions, 0);
      const totalClicks = urlGroups.reduce((s, g) => s + g.clicks, 0);
      return {
        card1: { title: "URLs Unicas", value: formatNumber(urlGroups.length), icon: Link2, color: "text-blue-400" },
        card2: { title: "Investimento", value: formatCurrency(totalSpend), icon: DollarSign, color: "text-success" },
        card3: { title: "ROAS Medio", value: `${(totalSpend > 0 ? totalRevenue / totalSpend : 0).toFixed(2)}x`, icon: Target, color: "text-purple-400" },
        card4: { title: "CTR Medio", value: formatPercent(totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0), icon: MousePointerClick, color: "text-warning" },
      };
    }

    const dataset = activeTab === "paused" ? pausedWithResults : activeAds;
    const totalSpend = dataset.reduce((s, a) => s + a.spend, 0);
    const totalRevenue = dataset.reduce((s, a) => s + a.revenue, 0);
    const totalImpressions = dataset.reduce((s, a) => s + a.impressions, 0);
    const totalClicks = dataset.reduce((s, a) => s + a.clicks, 0);
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    if (activeTab === "paused") {
      const bestRoas = pausedWithResults.length > 0 ? Math.max(...pausedWithResults.map((a) => a.roas)) : 0;
      return {
        card1: { title: "Criativos Pausados", value: formatNumber(pausedWithResults.length), icon: Pause, color: "text-yellow-400" },
        card2: { title: "Invest. no Periodo", value: formatCurrency(totalSpend), icon: DollarSign, color: "text-success" },
        card3: { title: "Melhor ROAS", value: `${bestRoas.toFixed(2)}x`, icon: TrendingUp, color: "text-emerald-400" },
        card4: { title: "ROAS Medio", value: `${avgRoas.toFixed(2)}x`, icon: Target, color: "text-purple-400" },
      };
    }

    return {
      card1: { title: "Criativos Ativos", value: formatNumber(activeAds.length), icon: ImageIcon, color: "text-blue-400" },
      card2: { title: "Investimento", value: formatCurrency(totalSpend), icon: DollarSign, color: "text-success" },
      card3: { title: "ROAS Medio", value: `${avgRoas.toFixed(2)}x`, icon: Target, color: "text-purple-400" },
      card4: { title: "CTR Medio", value: formatPercent(avgCtr), icon: MousePointerClick, color: "text-warning" },
    };
  }, [activeTab, activeAds, pausedWithResults, urlGroups]);

  const formatBadge = (format: string) => {
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
          <p className="text-sm font-medium truncate">{String(val)}</p>
          {row.body ? (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {String(row.body).slice(0, 80)}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "campaign_name", label: "Campanha" },
    {
      key: "format",
      label: "Formato",
      render: (val: unknown) => (
        <Badge variant="secondary" className="text-xs">
          {formatBadge(String(val))}
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
      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
            loading={loading}
          />
          <KpiCard
            title={kpis.card2.title}
            value={kpis.card2.value}
            icon={kpis.card2.icon}
            iconColor={kpis.card2.color}
            loading={loading}
            badge="Meta"
            badgeColor="#1877f2"
          />
          <KpiCard
            title={kpis.card3.title}
            value={kpis.card3.value}
            icon={kpis.card3.icon}
            iconColor={kpis.card3.color}
            loading={loading}
          />
          <KpiCard
            title={kpis.card4.title}
            value={kpis.card4.value}
            icon={kpis.card4.icon}
            iconColor={kpis.card4.color}
            loading={loading}
          />
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-2 mt-4">
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
        </div>

        {/* Tab Content */}
        <TabsContent value="active">
          <PerformanceTable
            title={tableTitle}
            columns={adColumns}
            data={sortedData as Array<Record<string, unknown>>}
            loading={loading}
            onRowClick={(row) => setSelectedAd(row as unknown as ActiveAdCreative)}
          />
        </TabsContent>

        <TabsContent value="paused">
          {!loading && pausedWithResults.length === 0 ? (
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
              loading={loading}
              onRowClick={(row) => setSelectedAd(row as unknown as ActiveAdCreative)}
            />
          )}
        </TabsContent>

        <TabsContent value="urls">
          {!loading && urlGroups.length === 0 ? (
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
              loading={loading}
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
                <DialogTitle>{selectedAd.ad_name}</DialogTitle>
                <DialogDescription>
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
                  <div className="flex items-center gap-2">
                    {selectedAd.cta && (
                      <Badge variant="secondary">
                        {selectedAd.cta.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {formatBadge(selectedAd.format)}
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
