"use client";

import React, { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAccount } from "@/lib/account-context";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { Creative } from "@/lib/types";

interface CreativeDetails {
  creative: Creative;
  ads: Array<{
    id: string;
    name: string;
    status: string;
    campaign_id: string;
    adset_id: string;
    campaign?: { name: string; id: string };
    adset?: { name: string; id: string };
  }>;
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    reach: number;
    ctr: number;
    cpc: number;
  };
}

export default function CreativesPage() {
  const { accountId } = useAccount();
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCreative, setSelectedCreative] = useState<Creative | null>(null);
  const [details, setDetails] = useState<CreativeDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchCreatives = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/creatives?account_id=${accountId}`);
      const data = await res.json();
      setCreatives(data.creatives || []);
    } catch {
      // Keep empty state
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchCreatives();
  }, [fetchCreatives]);

  async function handleSelectCreative(creative: Creative) {
    setSelectedCreative(creative);
    setDetails(null);
    setDetailsLoading(true);
    try {
      const res = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "details",
          creative_id: creative.id,
          account_id: accountId,
        }),
      });
      const data = await res.json();
      setDetails(data);
    } catch {
      // Keep null
    } finally {
      setDetailsLoading(false);
    }
  }

  const hasMetrics = details?.metrics && (
    details.metrics.impressions > 0 ||
    details.metrics.clicks > 0 ||
    details.metrics.spend > 0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Criativos</h1>
        <p className="text-sm text-muted-foreground">
          Visualize e gerencie seus criativos de anúncio
        </p>
      </div>

      {/* Creative Detail Dialog - 2 columns */}
      <Dialog
        open={!!selectedCreative}
        onOpenChange={() => {
          setSelectedCreative(null);
          setDetails(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCreative?.name || "Criativo"}</DialogTitle>
            <DialogDescription>
              ID: {selectedCreative?.id}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            {/* Left Column - Preview */}
            <div className="space-y-4">
              {selectedCreative?.image_url || selectedCreative?.thumbnail_url ? (
                <img
                  src={selectedCreative.image_url || selectedCreative.thumbnail_url}
                  alt={selectedCreative.name}
                  className="w-full rounded-lg border border-border object-cover max-h-[300px]"
                />
              ) : (
                <div className="w-full h-48 rounded-lg bg-muted flex items-center justify-center border border-border">
                  <ImageIcon className="h-12 w-12 text-muted-foreground" />
                </div>
              )}

              {selectedCreative?.title && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Título</p>
                  <p className="text-sm font-medium">{selectedCreative.title}</p>
                </div>
              )}
              {selectedCreative?.body && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Texto</p>
                  <p className="text-sm leading-relaxed">{selectedCreative.body}</p>
                </div>
              )}
              {selectedCreative?.call_to_action_type && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">CTA</p>
                  <Badge variant="secondary">
                    {selectedCreative.call_to_action_type.replace(/_/g, " ")}
                  </Badge>
                </div>
              )}
            </div>

            {/* Right Column - Info & Metrics */}
            <div className="space-y-5">
              {/* Campaign & Ad Set Info */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Vinculação
                </h3>
                {detailsLoading ? (
                  <div className="space-y-2">
                    <div className="h-10 animate-pulse rounded bg-muted" />
                    <div className="h-10 animate-pulse rounded bg-muted" />
                  </div>
                ) : details?.ads && details.ads.length > 0 ? (
                  <div className="space-y-2">
                    {details.ads.map((ad) => (
                      <div
                        key={ad.id}
                        className="rounded-lg border border-border p-3 space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Campanha:</span>
                          <span className="text-sm font-medium truncate">
                            {ad.campaign?.name || ad.campaign_id}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Ad Set:</span>
                          <span className="text-sm font-medium truncate">
                            {ad.adset?.name || ad.adset_id}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground ml-5">Ad:</span>
                          <span className="text-sm truncate">{ad.name}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ml-auto ${
                              ad.status === "ACTIVE"
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-warning/10 text-warning border-warning/20"
                            }`}
                          >
                            {ad.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {detailsLoading ? "Carregando..." : "Nenhum anúncio vinculado"}
                  </p>
                )}
              </div>

              {/* Metrics */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Performance (últimos 30 dias)
                </h3>
                {detailsLoading ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-16 animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                ) : hasMetrics ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard
                      icon={Eye}
                      label="Impressões"
                      value={formatNumber(details!.metrics.impressions)}
                    />
                    <MetricCard
                      icon={MousePointerClick}
                      label="Cliques"
                      value={formatNumber(details!.metrics.clicks)}
                    />
                    <MetricCard
                      icon={DollarSign}
                      label="Investimento"
                      value={formatCurrency(details!.metrics.spend)}
                    />
                    <MetricCard
                      icon={Users}
                      label="Alcance"
                      value={formatNumber(details!.metrics.reach)}
                    />
                    <MetricCard
                      icon={Target}
                      label="CTR"
                      value={formatPercent(details!.metrics.ctr)}
                    />
                    <MetricCard
                      icon={TrendingUp}
                      label="CPC"
                      value={formatCurrency(details!.metrics.cpc)}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem dados de performance disponíveis
                  </p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Creatives Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="animate-pulse space-y-3">
                  <div className="h-40 rounded bg-muted" />
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : creatives.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Nenhum criativo encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Criativos aparecerão aqui quando forem criados
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {creatives.map((creative) => (
            <Card
              key={creative.id}
              className="cursor-pointer hover:border-primary/20 transition-colors"
              onClick={() => handleSelectCreative(creative)}
            >
              <CardContent className="p-4">
                {creative.image_url || creative.thumbnail_url ? (
                  <img
                    src={creative.thumbnail_url || creative.image_url}
                    alt={creative.name}
                    className="w-full h-40 object-cover rounded-lg mb-3 bg-muted"
                  />
                ) : (
                  <div className="w-full h-40 rounded-lg mb-3 bg-muted flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <p className="text-sm font-medium truncate">
                  {creative.name || `Criativo ${creative.id}`}
                </p>
                {creative.call_to_action_type && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {creative.call_to_action_type.replace(/_/g, " ")}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
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
