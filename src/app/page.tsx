"use client";

import React, { useEffect, useState } from "react";
import {
  DollarSign,
  Eye,
  MousePointerClick,
  TrendingUp,
  Target,
  BarChart3,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { DatePreset } from "@/lib/types";

interface OverviewData {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  reach: number;
  trendData: Array<Record<string, unknown>>;
  topCampaigns: Array<Record<string, unknown>>;
}

export default function OverviewPage() {
  const { accountId } = useAccount();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData>({
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    reach: 0,
    trendData: [],
    topCampaigns: [],
  });

  useEffect(() => {
    if (!accountId) return;

    async function fetchData() {
      setLoading(true);
      try {
        // Fetch account insights
        const [insightsRes, campaignsRes] = await Promise.all([
          fetch(`/api/insights?object_id=${accountId}&level=account&date_preset=${datePreset}`),
          fetch(`/api/campaigns?account_id=${accountId}&limit=5`),
        ]);

        const insightsData = await insightsRes.json();
        const campaignsData = await campaignsRes.json();

        // Process insights
        const insights = insightsData.insights || [];
        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalReach = 0;

        const trendData = insights.map(
          (row: Record<string, string>) => {
            const spend = parseFloat(row.spend || "0");
            const impressions = parseFloat(row.impressions || "0");
            const clicks = parseFloat(row.clicks || "0");
            const reach = parseFloat(row.reach || "0");

            totalSpend += spend;
            totalImpressions += impressions;
            totalClicks += clicks;
            totalReach += reach;

            return {
              date: row.date_start?.slice(5) || "",
              spend: (spend / 100).toFixed(2),
              impressions,
              clicks,
            };
          }
        );

        const ctr =
          totalImpressions > 0
            ? (totalClicks / totalImpressions) * 100
            : 0;
        const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

        // Process top campaigns
        const campaigns = campaignsData.campaigns || [];

        setData({
          spend: totalSpend,
          impressions: totalImpressions,
          clicks: totalClicks,
          ctr,
          cpc,
          reach: totalReach,
          trendData,
          topCampaigns: campaigns,
        });
      } catch {
        // Keep default empty state
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [datePreset, accountId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral da sua conta Meta Ads
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          title="Investimento"
          value={formatCurrency(data.spend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
        />
        <KpiCard
          title="Impressões"
          value={formatNumber(data.impressions)}
          icon={Eye}
          iconColor="text-info"
          loading={loading}
        />
        <KpiCard
          title="Cliques"
          value={formatNumber(data.clicks)}
          icon={MousePointerClick}
          iconColor="text-primary"
          loading={loading}
        />
        <KpiCard
          title="CTR"
          value={formatPercent(data.ctr)}
          icon={Target}
          iconColor="text-warning"
          loading={loading}
        />
        <KpiCard
          title="CPC"
          value={formatCurrency(data.cpc)}
          icon={TrendingUp}
          iconColor="text-destructive"
          loading={loading}
        />
        <KpiCard
          title="Alcance"
          value={formatNumber(data.reach)}
          icon={BarChart3}
          iconColor="text-purple-400"
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Investimento ao longo do tempo"
          data={data.trendData}
          lines={[
            { key: "spend", label: "Spend (R$)", color: "#22c55e" },
          ]}
          loading={loading}
        />
        <TrendChart
          title="Impressões e Cliques"
          data={data.trendData}
          lines={[
            { key: "impressions", label: "Impressões", color: "#3b82f6" },
            { key: "clicks", label: "Cliques", color: "#1877f2" },
          ]}
          loading={loading}
        />
      </div>

      {/* Top Campaigns */}
      <PerformanceTable
        title="Top Campanhas"
        columns={[
          { key: "name", label: "Nome" },
          { key: "status", label: "Status", format: "status" },
          { key: "objective", label: "Objetivo" },
          { key: "daily_budget", label: "Orçamento Diário", format: "currency", align: "right" },
        ]}
        data={data.topCampaigns}
        loading={loading}
      />
    </div>
  );
}
