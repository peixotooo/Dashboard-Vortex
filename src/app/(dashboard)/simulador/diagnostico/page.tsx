"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  Landmark,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, datePresetToTimeRange } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";

// --- Types (subset of Overview) ---

interface DailyRow {
  date: string;
  totalSpend: number;
  revenue: number;
  roas: number;
  sessions: number;
  pedidos: number;
  ticketMedio: number;
  txConversao: number;
  cpc: number;
}

interface FinancialSettings {
  monthly_fixed_costs: number;
  tax_pct: number;
  product_cost_pct: number;
  other_expenses_pct: number;
  monthly_seasonality: number[];
  target_profit_monthly: number;
  safety_margin_pct: number;
  isDefault: boolean;
}

const FIN_DEFAULTS: FinancialSettings = {
  monthly_fixed_costs: 160000,
  tax_pct: 6,
  product_cost_pct: 25,
  other_expenses_pct: 5,
  monthly_seasonality: [6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98],
  target_profit_monthly: 0,
  safety_margin_pct: 5,
  isDefault: true,
};

// --- Helpers ---

function extractAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!actions) return 0;
  const action = actions.find((a) => a.action_type === type);
  return action ? parseFloat(action.value || "0") : 0;
}

function extractActionValue(
  actionValues: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!actionValues) return 0;
  const action = actionValues.find((a) => a.action_type === type);
  return action ? parseFloat(action.value || "0") : 0;
}

// Color only for significant deviations (>10%)
function deviationClass(actual: number, expected: number, invert = false): string {
  if (expected === 0) return "";
  const gap = ((actual - expected) / expected) * 100;
  if (invert) {
    // For cost metrics: red if spending MORE than expected
    if (gap > 10) return "text-destructive";
    if (gap < -10) return "text-success";
    return "";
  }
  // For revenue metrics: red if below expected
  if (gap < -10) return "text-destructive";
  if (gap > 10) return "text-success";
  return "";
}

export default function DiagnosticoPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<DailyRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [vndaShipping, setVndaShipping] = useState(0);
  const [vndaDiscount, setVndaDiscount] = useState(0);
  const [vndaConfigured, setVndaConfigured] = useState(false);
  const [finSettings, setFinSettings] = useState<FinancialSettings>(FIN_DEFAULTS);

  useEffect(() => {
    if (!accountId || accounts.length === 0) return;

    async function fetchData() {
      setLoading(true);
      try {
        const datePreset = "last_30d";
        const accountIds = accountId === "all" ? accounts.map((a) => a.id) : [accountId];

        const vndaHeaders: Record<string, string> = {};
        if (workspace?.id) vndaHeaders["x-workspace-id"] = workspace.id;

        const [insightsResults, ga4Res, vndaRes, finRes] = await Promise.all([
          Promise.all(
            accountIds.map((id) =>
              fetch(`/api/insights?object_id=${id}&level=account&date_preset=${datePreset}`).then((r) => r.json())
            )
          ),
          fetch(`/api/ga4/insights?date_preset=${datePreset}`),
          fetch(`/api/vnda/insights?date_preset=${datePreset}`, { headers: vndaHeaders }),
          workspace?.id
            ? fetch("/api/financial-settings", { headers: vndaHeaders })
            : Promise.resolve(null),
        ]);

        const ga4Data = await ga4Res.json();
        const vndaData = await vndaRes.json();
        const settings: FinancialSettings = finRes ? await finRes.json() : FIN_DEFAULTS;
        setFinSettings(settings);

        // Process Meta daily data
        const dailyAggMap = new Map<string, { dateRaw: string; spend: number; cpc: number; clicks: number; impressions: number; metaRevenue: number; metaPurchases: number }>();
        let totalMetaRevenue = 0;
        let totalMetaPurchases = 0;
        let totalSpend = 0;

        for (const insightsData of insightsResults) {
          for (const row of insightsData.insights || []) {
            const spend = parseFloat((row.spend as string) || "0");
            const clicks = parseFloat((row.clicks as string) || "0");
            const impressions = parseFloat((row.impressions as string) || "0");
            const metaRevenue = extractActionValue(row.action_values, "purchase");
            const metaPurchases = extractAction(row.actions, "purchase");

            totalSpend += spend;
            totalMetaRevenue += metaRevenue;
            totalMetaPurchases += metaPurchases;

            const dateRaw = ((row.date_start as string) || "").slice(0, 10);
            const existing = dailyAggMap.get(dateRaw);
            if (existing) {
              existing.spend += spend;
              existing.clicks += clicks;
              existing.impressions += impressions;
              existing.metaRevenue += metaRevenue;
              existing.metaPurchases += metaPurchases;
              existing.cpc = existing.clicks > 0 ? existing.spend / existing.clicks : 0;
            } else {
              dailyAggMap.set(dateRaw, {
                dateRaw,
                spend,
                cpc: clicks > 0 ? spend / clicks : 0,
                clicks,
                impressions,
                metaRevenue,
                metaPurchases,
              });
            }
          }
        }

        // GA4
        const ga4Configured = ga4Data.configured === true;
        const ga4Insights: Array<{ dateRaw: string; sessions: number; transactions: number; revenue: number }> =
          (ga4Data.insights || []).map((row: Record<string, unknown>) => ({
            dateRaw: (row.dateRaw as string) || "",
            sessions: (row.sessions as number) || 0,
            transactions: (row.transactions as number) || 0,
            revenue: (row.revenue as number) || 0,
          }));
        const ga4Totals = ga4Data.totals || { sessions: 0, transactions: 0, revenue: 0 };

        // Google Ads
        const gadsDaily: Array<{ dateRaw: string; cost: number }> =
          (ga4Data.googleAds?.daily || []).map((row: Record<string, unknown>) => ({
            dateRaw: (row.dateRaw as string) || "",
            cost: (row.cost as number) || 0,
          }));
        const gadsTotalCost = ga4Data.googleAds?.totals?.cost || 0;

        // VNDA
        const isVndaConfigured = vndaData.configured === true;
        setVndaConfigured(isVndaConfigured);
        const vndaInsights: Array<{ dateRaw: string; orders: number; revenue: number }> =
          (vndaData.insights || []).map((row: Record<string, unknown>) => ({
            dateRaw: (row.dateRaw as string) || "",
            orders: (row.orders as number) || 0,
            revenue: (row.revenue as number) || 0,
          }));
        const vndaTotals = vndaData.totals || { orders: 0, revenue: 0, shipping: 0, discount: 0 };
        setVndaShipping(vndaTotals.shipping || 0);
        setVndaDiscount(vndaTotals.discount || 0);

        // Merge daily data
        const normDate = (raw: string) =>
          raw.length === 8 && !raw.includes("-")
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw.slice(0, 10);
        const toDisplay = (raw: string) => `${raw.slice(8, 10)}/${raw.slice(5, 7)}`;

        const metaMap = new Map([...dailyAggMap.values()].map((d) => [d.dateRaw, d]));
        const ga4Map = new Map(ga4Insights.map((d) => [normDate(d.dateRaw), d]));
        const vndaMap = new Map(vndaInsights.map((d) => [normDate(d.dateRaw), d]));
        const gadsMap = new Map(gadsDaily.map((d) => [normDate(d.dateRaw), d]));

        const allDatesSet = new Set<string>();
        for (const [k] of metaMap) allDatesSet.add(k);
        for (const [k] of ga4Map) allDatesSet.add(k);
        for (const [k] of vndaMap) allDatesSet.add(k);
        for (const [k] of gadsMap) allDatesSet.add(k);

        const expectedRange = datePresetToTimeRange("this_month");
        const allDates = [...allDatesSet].filter((d) => d >= expectedRange.since && d <= expectedRange.until).sort();

        const trend: DailyRow[] = allDates.map((rawDate) => {
          const metaDay = metaMap.get(rawDate);
          const ga4Day = ga4Map.get(rawDate);
          const vndaDay = vndaMap.get(rawDate);
          const gadsDay = gadsMap.get(rawDate);

          const spend = metaDay?.spend ?? 0;
          const googleAdsCost = gadsDay?.cost ?? 0;
          const totalDaySpend = spend + googleAdsCost;

          const revenue = isVndaConfigured ? (vndaDay?.revenue ?? 0) : ga4Configured ? (ga4Day?.revenue ?? 0) : (metaDay?.metaRevenue ?? 0);
          const transactions = isVndaConfigured ? (vndaDay?.orders ?? 0) : ga4Configured ? (ga4Day?.transactions ?? 0) : (metaDay?.metaPurchases ?? 0);
          const sessions = ga4Day?.sessions ?? 0;

          return {
            date: toDisplay(rawDate),
            totalSpend: parseFloat(totalDaySpend.toFixed(2)),
            revenue: parseFloat(revenue.toFixed(2)),
            roas: totalDaySpend > 0 ? parseFloat((revenue / totalDaySpend).toFixed(2)) : 0,
            sessions,
            pedidos: transactions,
            ticketMedio: transactions > 0 ? parseFloat((revenue / transactions).toFixed(2)) : 0,
            txConversao: sessions > 0 ? parseFloat(((transactions / sessions) * 100).toFixed(2)) : 0,
            cpc: metaDay?.cpc ?? 0,
          };
        });

        setTrendData(trend);

        const rev = isVndaConfigured ? vndaTotals.revenue : ga4Configured ? ga4Totals.revenue : totalMetaRevenue;
        setTotalRevenue(rev);
        setTotalInvestment(totalSpend + gadsTotalCost);
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [accountId, accounts, workspace?.id]);

  // --- Diagnostic calculations ---
  const calc = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentMonthStr = String(currentMonth + 1).padStart(2, "0");
    const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
    const currentDay = now.getDate();

    const monthData = trendData.filter((d) => d.date.slice(3, 5) === currentMonthStr);
    const monthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0);
    const daysWithData = monthData.length;
    const avgDaily = daysWithData > 0 ? monthRevenue / daysWithData : 0;

    // Variable cost percentages
    const fretePerc = totalRevenue > 0 && vndaConfigured ? (vndaShipping / totalRevenue) * 100 : 0;
    const descontoPerc = totalRevenue > 0 && vndaConfigured ? (vndaDiscount / totalRevenue) * 100 : 0;
    const investPerc = totalRevenue > 0 ? (totalInvestment / totalRevenue) * 100 : 0;

    const { tax_pct, product_cost_pct, other_expenses_pct, monthly_fixed_costs, target_profit_monthly, safety_margin_pct, monthly_seasonality } = finSettings;
    const totalVarCostPct = investPerc + fretePerc + descontoPerc + tax_pct + product_cost_pct + other_expenses_pct;
    const contributionMarginPct = 100 - totalVarCostPct;

    // Monthly target with seasonality
    const effectiveMargin = contributionMarginPct - safety_margin_pct;
    const annualTarget = effectiveMargin > 0
      ? ((monthly_fixed_costs + target_profit_monthly) * 12) / (effectiveMargin / 100)
      : 0;
    const seasonalityWeight = (monthly_seasonality?.[currentMonth] ?? 8.33) / 100;
    const monthTarget = annualTarget * seasonalityWeight;

    // Daily target
    const dailyRevenueTarget = daysInMonth > 0 ? monthTarget / daysInMonth : 0;

    // Month averages
    const totalMonthSessions = monthData.reduce((s, d) => s + d.sessions, 0);
    const totalMonthPedidos = monthData.reduce((s, d) => s + d.pedidos, 0);
    const totalMonthSpend = monthData.reduce((s, d) => s + d.totalSpend, 0);
    const avgDailySessions = daysWithData > 0 ? totalMonthSessions / daysWithData : 0;
    const avgDailySpend = daysWithData > 0 ? totalMonthSpend / daysWithData : 0;
    const avgTicket = totalMonthPedidos > 0 ? monthRevenue / totalMonthPedidos : 0;
    const avgTxConv = totalMonthSessions > 0 ? (totalMonthPedidos / totalMonthSessions) * 100 : 0;
    const avgRoas = totalMonthSpend > 0 ? monthRevenue / totalMonthSpend : 0;
    const avgCps = totalMonthSessions > 0 ? totalMonthSpend / totalMonthSessions : 0;

    // Needed values — ticket e CPS TRAVADOS nos valores reais
    const pedidosNeeded = avgTicket > 0 ? dailyRevenueTarget / avgTicket : 0;
    const sessionsNeeded = avgTxConv > 0 ? pedidosNeeded / (avgTxConv / 100) : 0;
    const txConvNeeded = (avgDailySessions > 0 && avgTicket > 0) ? (pedidosNeeded / avgDailySessions) * 100 : 0;
    const investNeeded = avgCps > 0 ? sessionsNeeded * avgCps : avgDailySpend;
    const roasNeeded = investNeeded > 0 ? dailyRevenueTarget / investNeeded : 0;

    function calcGap(actual: number, needed: number) {
      if (needed === 0) return 0;
      return ((actual - needed) / needed) * 100;
    }
    type VillainStatus = "ok" | "warning" | "critical";
    function getStatus(gap: number): VillainStatus {
      if (gap >= 0) return "ok";
      if (gap >= -15) return "warning";
      return "critical";
    }

    const villains = [
      {
        name: "Investimento/dia", actual: avgDailySpend, needed: investNeeded,
        gap: calcGap(avgDailySpend, investNeeded), format: "currency" as const,
        insight: calcGap(avgDailySpend, investNeeded) < 0
          ? "Aumente o budget de midia para gerar as sessoes necessarias (CPS travado em " + formatCurrency(avgCps) + ")."
          : "Budget adequado para a meta.",
      },
      {
        name: "Sessoes/dia", actual: avgDailySessions, needed: sessionsNeeded,
        gap: calcGap(avgDailySessions, sessionsNeeded), format: "number" as const,
        insight: calcGap(avgDailySessions, sessionsNeeded) < 0
          ? "Aumente investimento em trafego ou diversifique canais (SEO, email, social)."
          : "Volume de trafego adequado para a meta.",
      },
      {
        name: "TX Conversao", actual: avgTxConv, needed: txConvNeeded,
        gap: calcGap(avgTxConv, txConvNeeded), format: "percent" as const,
        insight: calcGap(avgTxConv, txConvNeeded) < 0
          ? "Revise a experiencia de compra: checkout, frete, persuasao na pagina de produto."
          : "Taxa de conversao saudavel para a meta.",
      },
    ].map((v) => ({ ...v, status: getStatus(v.gap) })).sort((a, b) => a.gap - b.gap);

    // Daily diagnostic table — ticket e CPS TRAVADOS, alavancas com valores needed
    const dailyDiagnostic = monthData.map((d) => ({
      date: d.date,
      invest: d.totalSpend,
      investExpected: investNeeded,
      sessions: d.sessions,
      sessionsExpected: Math.round(sessionsNeeded),
      txConversao: d.txConversao,
      txExpected: avgTxConv,
      pedidos: d.pedidos,
      pedidosExpected: Math.round(pedidosNeeded),
      ticketMedio: d.ticketMedio,
      ticketExpected: avgTicket,       // TRAVADO
      revenue: d.revenue,
      revenueExpected: dailyRevenueTarget,
      roas: d.roas,
      roasExpected: roasNeeded,
      cps: d.sessions > 0 ? d.totalSpend / d.sessions : 0,
      cpsExpected: avgCps,             // TRAVADO
    }));

    // Action plan — apenas alavancas controlaveis
    const actionPlan: string[] = [];
    const badVillains = villains.filter((v) => v.status !== "ok");
    for (const v of badVillains) {
      if (v.name === "Investimento/dia") actionPlan.push("Aumentar budget de midia para " + formatCurrency(investNeeded) + "/dia (+" + formatCurrency(investNeeded - avgDailySpend) + " vs atual).");
      else if (v.name === "Sessoes/dia") actionPlan.push("Gerar " + formatNumber(Math.round(sessionsNeeded)) + " sessoes/dia via trafego pago ou canais organicos (SEO, email, social).");
      else if (v.name === "TX Conversao") actionPlan.push("Elevar TX Conversao de " + avgTxConv.toFixed(2) + "% para " + txConvNeeded.toFixed(2) + "% via CRO: checkout, frete, pagina de produto.");
    }

    return {
      monthTarget,
      dailyRevenueTarget,
      monthRevenue,
      avgDaily,
      daysWithData,
      daysInMonth,
      currentDay,
      // Locked params
      avgTicket,
      avgCps,
      // Villains & diagnostic
      villains,
      dailyDiagnostic,
      actionPlan,
    };
  }, [trendData, totalRevenue, totalInvestment, vndaShipping, vndaDiscount, vndaConfigured, finSettings]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" />
            Diagnostico de Metricas
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const deficit = calc.dailyRevenueTarget - calc.avgDaily;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" />
            Diagnostico de Metricas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Meta mensal: {formatCurrency(calc.monthTarget)} | Meta diaria: {formatCurrency(calc.dailyRevenueTarget)} | Media realizada: {formatCurrency(calc.avgDaily)}
            {deficit > 0 && (
              <span className="text-destructive font-medium ml-1">
                (deficit de {formatCurrency(deficit)}/dia)
              </span>
            )}
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-accent transition-colors font-medium"
        >
          Voltar ao Overview
        </Link>
      </div>

      {/* Locked Params + Villain Cards */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Analise por Metrica
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Parametros travados: <span className="font-semibold text-foreground">Ticket Medio {formatCurrency(calc.avgTicket)}</span> | <span className="font-semibold text-foreground">CPS {formatCurrency(calc.avgCps)}</span>
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {calc.villains.map((v) => {
              const gapColor = v.status === "ok" ? "text-success" : v.status === "warning" ? "text-warning" : "text-destructive";
              const GapIcon = v.gap >= 0 ? ArrowUpRight : ArrowDownRight;

              function fmtVal(val: number) {
                if (v.format === "currency") return formatCurrency(val);
                if (v.format === "percent") return `${val.toFixed(2)}%`;
                return formatNumber(val);
              }

              return (
                <div key={v.name} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{v.name}</span>
                    <div className={`flex items-center gap-0.5 text-xs font-semibold ${gapColor}`}>
                      <GapIcon className="h-3 w-3" />
                      {v.gap >= 0 ? "+" : ""}{v.gap.toFixed(0)}%
                    </div>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Atual</span>
                      <span className="font-semibold">{fmtVal(v.actual)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Necessario</span>
                      <span className="font-semibold">{fmtVal(v.needed)}</span>
                    </div>
                  </div>
                  {v.status !== "ok" && (
                    <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
                      <Lightbulb className="h-2.5 w-2.5 mt-0.5 flex-shrink-0 text-primary" />
                      {v.insight}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Action Plan */}
      {calc.actionPlan.length > 0 && calc.villains.some((v) => v.status !== "ok") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Plano de Acao
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {calc.actionPlan.map((action, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs">
                    {i + 1}
                  </span>
                  <p className="text-muted-foreground pt-0.5">{action}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Controle Diario — Esperado vs Realizado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Data</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>Investimento</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>Sessoes</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>TX Conv</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>Pedidos</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>Ticket Medio</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>Receita</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>ROAS</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" colSpan={2}>CPS</th>
                </tr>
                <tr className="border-b border-border">
                  <th className="px-3 py-1"></th>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <React.Fragment key={i}>
                      <th className="px-3 py-1 text-right text-[10px] text-muted-foreground font-normal">Real</th>
                      <th className="px-3 py-1 text-right text-[10px] text-muted-foreground font-normal">Esp.</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calc.dailyDiagnostic.map((d, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="px-3 py-2 font-medium">{d.date}</td>
                    {/* Investimento (inverted: red if above) */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.invest, d.investExpected, true)}`}>
                      {formatCurrency(d.invest)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(d.investExpected)}</td>
                    {/* Sessoes */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.sessions, d.sessionsExpected)}`}>
                      {formatNumber(d.sessions)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatNumber(d.sessionsExpected)}</td>
                    {/* TX Conv */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.txConversao, d.txExpected)}`}>
                      {d.txConversao.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{d.txExpected.toFixed(2)}%</td>
                    {/* Pedidos */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.pedidos, d.pedidosExpected)}`}>
                      {d.pedidos}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{d.pedidosExpected}</td>
                    {/* Ticket Medio */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.ticketMedio, d.ticketExpected)}`}>
                      {formatCurrency(d.ticketMedio)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(d.ticketExpected)}</td>
                    {/* Receita */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.revenue, d.revenueExpected)}`}>
                      {formatCurrency(d.revenue)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(d.revenueExpected)}</td>
                    {/* ROAS */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.roas, d.roasExpected)}`}>
                      {d.roas.toFixed(2)}x
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{d.roasExpected.toFixed(2)}x</td>
                    {/* CPS (inverted) */}
                    <td className={`px-3 py-2 text-right font-medium ${deviationClass(d.cps, d.cpsExpected, true)}`}>
                      {formatCurrency(d.cps)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatCurrency(d.cpsExpected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
