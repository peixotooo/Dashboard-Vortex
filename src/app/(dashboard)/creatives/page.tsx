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
  GalleryHorizontal,
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
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { DatePreset, ActiveAdCreative } from "@/lib/types";

export default function CreativesPage() {
  const { accountId, accounts } = useAccount();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [ads, setAds] = useState<ActiveAdCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<ActiveAdCreative | null>(null);
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const accountIds =
        accountId === "all" ? accounts.map((a) => a.id) : [accountId];

      const results = await Promise.all(
        accountIds.map((id) =>
          fetch(
            `/api/creatives?account_id=${id}&date_preset=${datePreset}`
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

  // KPI calculations
  const totalAds = ads.length;
  const totalSpend = ads.reduce((sum, a) => sum + a.spend, 0);
  const totalRevenue = ads.reduce((sum, a) => sum + a.revenue, 0);
  const totalImpressions = ads.reduce((sum, a) => sum + a.impressions, 0);
  const totalClicks = ads.reduce((sum, a) => sum + a.clicks, 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCtr =
    totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // Sorting
  const sortedAds = useMemo(() => {
    return [...ads].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey] ?? 0;
      const bVal = (b as unknown as Record<string, unknown>)[sortKey] ?? 0;
      const aNum = typeof aVal === "number" ? aVal : parseFloat(String(aVal)) || 0;
      const bNum = typeof bVal === "number" ? bVal : parseFloat(String(bVal)) || 0;
      return sortDir === "desc" ? bNum - aNum : aNum - bNum;
    });
  }, [ads, sortKey, sortDir]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Criativos</h1>
          <p className="text-sm text-muted-foreground">
            Performance dos criativos de campanhas ativas
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Criativos Ativos"
          value={formatNumber(totalAds)}
          icon={ImageIcon}
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

      {/* Sort controls */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* Performance Table */}
      <PerformanceTable
        title="Performance por Criativo"
        columns={[
          {
            key: "thumbnail_url",
            label: "",
            render: (val, row) => (
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
            render: (val, row) => (
              <div className="max-w-[220px]">
                <p className="text-sm font-medium truncate">{String(val)}</p>
                {row.body && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {String(row.body).slice(0, 80)}
                  </p>
                )}
              </div>
            ),
          },
          { key: "campaign_name", label: "Campanha" },
          {
            key: "format",
            label: "Formato",
            render: (val) => (
              <Badge variant="secondary" className="text-xs">
                {formatBadge(String(val))}
              </Badge>
            ),
          },
          {
            key: "impressions",
            label: "Impressoes",
            format: "number",
            align: "right",
          },
          { key: "clicks", label: "Cliques", format: "number", align: "right" },
          { key: "ctr", label: "CTR", format: "percent", align: "right" },
          { key: "cpc", label: "CPC", format: "currency", align: "right" },
          {
            key: "spend",
            label: "Investimento",
            format: "currency",
            align: "right",
          },
          {
            key: "revenue",
            label: "Receita",
            format: "currency",
            align: "right",
          },
          {
            key: "roas",
            label: "ROAS",
            align: "right",
            render: (val) => (
              <span className="font-medium">
                {Number(val || 0).toFixed(2)}x
              </span>
            ),
          },
        ]}
        data={sortedAds as unknown as Array<Record<string, unknown>>}
        loading={loading}
        onRowClick={(row) => setSelectedAd(row as unknown as ActiveAdCreative)}
      />

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
                  <div className="flex items-center gap-2">
                    {selectedAd.cta && (
                      <Badge variant="secondary">
                        {selectedAd.cta.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {formatBadge(selectedAd.format)}
                    </Badge>
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
