"use client";

import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, datePresetToTimeRange } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";

// --- Types ---

interface DailyRow {
  date: string;
  totalSpend: number;
  revenue: number;
  roas: number;
  sessions: number;
  pedidos: number;
  ticketMedio: number;
  txConversao: number;
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

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtK = (v: number) => `R$ ${(v / 1000).toFixed(1)}k`;

export default function EscalaPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<DailyRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
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
        const dailyAggMap = new Map<string, { dateRaw: string; spend: number; clicks: number; impressions: number; metaRevenue: number; metaPurchases: number }>();
        let totalMetaRevenue = 0;
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

            const dateRaw = ((row.date_start as string) || "").slice(0, 10);
            const existing = dailyAggMap.get(dateRaw);
            if (existing) {
              existing.spend += spend;
              existing.clicks += clicks;
              existing.impressions += impressions;
              existing.metaRevenue += metaRevenue;
              existing.metaPurchases += metaPurchases;
            } else {
              dailyAggMap.set(dateRaw, { dateRaw, spend, clicks, impressions, metaRevenue, metaPurchases });
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
          };
        });

        setTrendData(trend);
        const rev = isVndaConfigured ? vndaTotals.revenue : ga4Configured ? ga4Totals.revenue : totalMetaRevenue;
        setTotalRevenue(rev);
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [accountId, accounts, workspace?.id]);

  // --- Calculations ---
  const calc = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentMonthStr = String(currentMonth + 1).padStart(2, "0");
    const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();

    const monthData = trendData.filter((d) => d.date.slice(3, 5) === currentMonthStr);
    const daysWithData = monthData.length;

    // Variable cost percentages (EXCLUDING ads)
    const { tax_pct, product_cost_pct, other_expenses_pct, monthly_fixed_costs, monthly_seasonality } = finSettings;
    const fretePerc = totalRevenue > 0 && vndaConfigured ? (vndaShipping / totalRevenue) * 100 : 0;
    const descontoPerc = totalRevenue > 0 && vndaConfigured ? (vndaDiscount / totalRevenue) * 100 : 0;

    // MC pre-ads = 1 - all costs EXCEPT ads
    const custosSemAds = (fretePerc + descontoPerc + tax_pct + product_cost_pct + other_expenses_pct) / 100;
    const mcPreAdsPct = 1 - custosSemAds;

    // ROAS breakeven (where MC pos-ads = 0)
    const roasBreakeven = mcPreAdsPct > 0 ? 1 / mcPreAdsPct : 0;

    // Monthly target (same formula as Overview)
    const investPerc = totalRevenue > 0 ? 0 : 0; // Not used for MC pre-ads, but needed for monthTarget
    const totalVarCostPct = (fretePerc + descontoPerc + tax_pct + product_cost_pct + other_expenses_pct);
    // For monthTarget, we use the full contribution margin including ads from Overview
    const investPercReal = totalRevenue > 0 ? (monthData.reduce((s, d) => s + d.totalSpend, 0) / (totalRevenue || 1)) * 100 : 0;
    const contributionMarginPct = 100 - totalVarCostPct - investPercReal;
    const effectiveMargin = contributionMarginPct - finSettings.safety_margin_pct;
    const annualTarget = effectiveMargin > 0
      ? ((monthly_fixed_costs + finSettings.target_profit_monthly) * 12) / (effectiveMargin / 100)
      : 0;
    const seasonalityWeight = (monthly_seasonality?.[currentMonth] ?? 8.33) / 100;
    const monthTarget = annualTarget * seasonalityWeight;

    // Enrich daily data with MC pos-ads
    const enriched = monthData.map((d) => {
      const adsPct = d.revenue > 0 ? d.totalSpend / d.revenue : 0;
      const mcPosAds = mcPreAdsPct - adsPct;
      const lucroLiquido = d.revenue * mcPosAds;
      const roas = d.totalSpend > 0 ? d.revenue / d.totalSpend : 0;
      return { ...d, adsPct, mcPosAds, lucroLiquido, roas };
    });

    // Totals
    const totalInvest = enriched.reduce((s, d) => s + d.totalSpend, 0);
    const totalReceita = enriched.reduce((s, d) => s + d.revenue, 0);
    const totalLucro = enriched.reduce((s, d) => s + d.lucroLiquido, 0);
    const avgLucroDia = daysWithData > 0 ? totalLucro / daysWithData : 0;
    const avgInvestDia = daysWithData > 0 ? totalInvest / daysWithData : 0;
    const avgReceitaDia = daysWithData > 0 ? totalReceita / daysWithData : 0;
    const adsPctGlobal = totalReceita > 0 ? totalInvest / totalReceita : 0;
    const mcPosAdsGlobal = mcPreAdsPct - adsPctGlobal;
    const diasRestantes = daysInMonth - daysWithData;
    const projReceita = totalReceita + (avgReceitaDia * diasRestantes);
    const projLucro = totalLucro + (avgLucroDia * diasRestantes);
    const avgRoas = totalInvest > 0 ? totalReceita / totalInvest : 0;

    // Fixed costs + EBITDA
    const custoFixoDiario = daysInMonth > 0 ? monthly_fixed_costs / daysInMonth : 0;
    const ebitdaPct = 0.08;
    const mcPosAdsMinima = avgReceitaDia > 0 ? (custoFixoDiario / avgReceitaDia) + ebitdaPct : 0;

    // Accumulated data
    let accLucro = 0;
    let accInvest = 0;
    let accReceita = 0;
    const accumData = enriched.map((d) => {
      accLucro += d.lucroLiquido;
      accInvest += d.totalSpend;
      accReceita += d.revenue;
      const mcPosAdsAcum = accReceita > 0 ? mcPreAdsPct - (accInvest / accReceita) : 0;
      return {
        date: d.date,
        lucroAcum: parseFloat(accLucro.toFixed(2)),
        investAcum: parseFloat(accInvest.toFixed(2)),
        mcPosAdsAcum,
      };
    });

    // MC compression chart data
    const mcOverTime = enriched.map((d) => ({
      date: d.date,
      mcPosAds: d.mcPosAds * 100,
      adsPct: d.adsPct * 100,
      mcPreAds: mcPreAdsPct * 100,
    }));

    // Scenario simulation
    const scenarios: Array<{
      investDia: number;
      roasEst: number;
      receitaDia: number;
      adsPctEst: number;
      mcPosAdsEst: number;
      lucroDia: number;
      receitaMes: number;
      lucroMes: number;
      isCurrentAvg: boolean;
      cobreFixoEbitda: boolean;
    }> = [];

    if (avgRoas > 0 && avgInvestDia > 0) {
      for (let invest = 500; invest <= 8000; invest += 200) {
        const roasEst = avgRoas * Math.pow(avgInvestDia / invest, 0.18);
        const receitaDia = invest * roasEst;
        const adsPctEst = invest / receitaDia;
        const mcPosAdsEst = mcPreAdsPct - adsPctEst;
        const lucroDia = receitaDia * mcPosAdsEst;
        const receitaMes = totalReceita + (receitaDia * diasRestantes);
        const lucroMes = totalLucro + (lucroDia * diasRestantes);
        const isCurrentAvg = Math.abs(invest - avgInvestDia) < 150;
        const cobreFixoEbitda = lucroDia >= custoFixoDiario + (receitaDia * ebitdaPct);
        scenarios.push({ investDia: invest, roasEst, receitaDia, adsPctEst, mcPosAdsEst, lucroDia, receitaMes, lucroMes, isCurrentAvg, cobreFixoEbitda });
      }
    }

    const bestScenario = scenarios.length > 0
      ? scenarios.reduce((best, s) => s.lucroDia > best.lucroDia ? s : best, scenarios[0])
      : null;

    const gapMeta = monthTarget - projReceita;

    return {
      mcPreAdsPct,
      roasBreakeven,
      monthTarget,
      enriched,
      totalInvest,
      totalReceita,
      totalLucro,
      avgLucroDia,
      avgInvestDia,
      avgReceitaDia,
      adsPctGlobal,
      mcPosAdsGlobal,
      avgRoas,
      daysWithData,
      daysInMonth,
      diasRestantes,
      projReceita,
      projLucro,
      custoFixoDiario,
      ebitdaPct,
      mcPosAdsMinima,
      accumData,
      mcOverTime,
      scenarios,
      bestScenario,
      gapMeta,
    };
  }, [trendData, totalRevenue, vndaShipping, vndaDiscount, vndaConfigured, finSettings]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Painel de Escala
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Painel de Escala — Contribuicao Liquida
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            MC pre-ads: {pct(calc.mcPreAdsPct)} · ROAS Breakeven: {calc.roasBreakeven.toFixed(2)}x · MC pos-ads minima (fixo+EBITDA 8%): {pct(calc.mcPosAdsMinima)}
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-accent transition-colors font-medium"
        >
          Voltar ao Overview
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-success/20 bg-success/[0.03]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-2">Lucro Liquido Acumulado</p>
            <p className={`text-3xl font-black tabular-nums ${calc.totalLucro >= 0 ? "text-success" : "text-destructive"}`}>
              {formatCurrency(calc.totalLucro)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {calc.daysWithData} dias · media {formatCurrency(calc.avgLucroDia)}/dia
            </p>
          </CardContent>
        </Card>

        <Card className="border-warning/20 bg-warning/[0.03]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-warning mb-2">MC% Pos-Ads (Real)</p>
            <p className={`text-3xl font-black ${calc.mcPosAdsGlobal >= 0 ? "text-warning" : "text-destructive"}`}>
              {pct(calc.mcPosAdsGlobal)}
            </p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>pre-ads: {pct(calc.mcPreAdsPct)}</span>
              <span className="text-destructive">ads: {pct(calc.adsPctGlobal)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className={`${calc.gapMeta > 0 ? "border-destructive/20 bg-destructive/[0.03]" : "border-success/20 bg-success/[0.03]"}`}>
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2">Projecao vs Meta</p>
            <p className={`text-3xl font-black ${calc.gapMeta > 0 ? "text-destructive" : "text-success"}`}>
              {calc.gapMeta > 0 ? `-${fmtK(calc.gapMeta)}` : "Meta OK"}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              proj: {fmtK(calc.projReceita)} · meta: {fmtK(calc.monthTarget)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Equation Banner */}
      <div className="rounded-lg border border-border/50 bg-muted/20 px-5 py-3 flex items-center justify-center gap-6 flex-wrap text-xs font-mono">
        <span className="text-muted-foreground">Equacao:</span>
        <span className="text-success font-bold">Lucro</span>
        <span className="text-muted-foreground">=</span>
        <span className="text-foreground">Receita</span>
        <span className="text-muted-foreground">x</span>
        <span className="text-muted-foreground">(</span>
        <span className="text-warning">{pct(calc.mcPreAdsPct)}</span>
        <span className="text-muted-foreground">-</span>
        <span className="text-destructive">1/ROAS</span>
        <span className="text-muted-foreground">)</span>
        <span className="text-border">|</span>
        <span className="text-muted-foreground text-[10px]">+ investimento → ROAS cai → % ads sobe → MC% encolhe</span>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lucro Diario */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lucro Liquido Diario</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calc.enriched} barSize={26}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#12121a", border: "1px solid #2a2a3e", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value) => [formatCurrency(Number(value)), "Lucro"]}
                    labelFormatter={(label) => `Dia ${label}`}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                  <ReferenceLine y={calc.custoFixoDiario} stroke="#f59e0b" strokeDasharray="4 4" />
                  <Bar dataKey="lucroLiquido" radius={[4, 4, 0, 0]}>
                    {calc.enriched.map((entry, i) => (
                      <Cell key={i} fill={entry.lucroLiquido >= 0 ? "rgba(34,197,94,0.75)" : "rgba(239,68,68,0.75)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">Linha amarela = custo fixo diario ({formatCurrency(calc.custoFixoDiario)})</p>
          </CardContent>
        </Card>

        {/* MC Compression */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compressao da MC% (pre-ads → pos-ads)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calc.mcOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 60]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#12121a", border: "1px solid #2a2a3e", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value, name) => {
                      const label = name === "mcPosAds" ? "MC pos-ads" : name === "adsPct" ? "Custo Ads" : "MC pre-ads";
                      return [`${Number(value).toFixed(1)}%`, label];
                    }}
                  />
                  <ReferenceLine y={calc.mcPreAdsPct * 100} stroke="rgba(255,255,255,0.15)" strokeDasharray="6 4" />
                  <ReferenceLine y={0} stroke="rgba(239,68,68,0.3)" strokeWidth={2} />
                  <Area type="monotone" dataKey="adsPct" stackId="1" fill="rgba(239,68,68,0.2)" stroke="none" />
                  <Area type="monotone" dataKey="mcPosAds" stackId="1" fill="rgba(34,197,94,0.15)" stroke="none" />
                  <Line type="monotone" dataKey="mcPosAds" stroke="#22c55e" strokeWidth={2.5} dot={{ fill: "#22c55e", r: 3, strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">Verde = margem pos-ads · Vermelho = custo ads · Linha = MC% pos-ads</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Accumulated */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lucro Acumulado vs Investimento Acumulado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={calc.accumData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#12121a", border: "1px solid #2a2a3e", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value, name) => {
                      const label = name === "lucroAcum" ? "Lucro Acum." : "Invest. Acum.";
                      return [formatCurrency(Number(value)), label];
                    }}
                  />
                  <Area type="monotone" dataKey="lucroAcum" stroke="#22c55e" fill="rgba(34,197,94,0.12)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="investAcum" stroke="#ef4444" fill="rgba(239,68,68,0.06)" strokeWidth={2} strokeDasharray="4 4" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Scenario Simulation */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Simulacao: Lucro/dia vs Investimento/dia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calc.scenarios}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="investDia" tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                  <YAxis tick={{ fill: "#8888a0", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#12121a", border: "1px solid #2a2a3e", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value, name) => {
                      if (name === "lucroDia") return [formatCurrency(Number(value)), "Lucro/dia"];
                      return [value, name];
                    }}
                    labelFormatter={(v) => `Invest: ${formatCurrency(Number(v))}/dia`}
                  />
                  <ReferenceLine y={0} stroke="rgba(239,68,68,0.3)" strokeWidth={1.5} />
                  <ReferenceLine y={calc.custoFixoDiario} stroke="#f59e0b" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="lucroDia" fill="rgba(168,85,247,0.1)" stroke="none" />
                  <Line type="monotone" dataKey="lucroDia" stroke="#a855f7" strokeWidth={2.5} dot={false} />
                  {calc.avgInvestDia > 0 && (
                    <ReferenceLine x={Math.round(calc.avgInvestDia / 200) * 200} stroke="#f59e0b" strokeDasharray="4 4" />
                  )}
                  {calc.bestScenario && (
                    <ReferenceLine x={calc.bestScenario.investDia} stroke="#22c55e" strokeDasharray="4 4" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 text-[10px] text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-warning inline-block" /> ATUAL ({formatCurrency(calc.avgInvestDia)}/dia)</span>
              {calc.bestScenario && <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-success inline-block" /> OTIMO ({formatCurrency(calc.bestScenario.investDia)}/dia)</span>}
              <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-warning inline-block" style={{ borderTop: "1px dashed" }} /> Custo fixo diario</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Decision Rule + Best Scenario */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-gradient-to-br from-success/[0.03] to-transparent">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-2">Regra de Decisao</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Escale investimento enquanto a <span className="text-success font-semibold">MC% pos-ads se mantiver positiva</span> (ROAS {">"} {calc.roasBreakeven.toFixed(2)}x).
              O ponto otimo e onde o lucro absoluto para de subir — nao onde o ROAS e mais alto.
              A MC pos-ads precisa cobrir custos fixos ({formatCurrency(calc.custoFixoDiario)}/dia) + EBITDA minimo de 8%.
            </p>
          </CardContent>
        </Card>

        {calc.bestScenario && (
          <Card className="bg-gradient-to-br from-purple-500/[0.03] to-transparent">
            <CardContent className="pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-2">Cenario Otimo Estimado</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Investir <span className="text-purple-400 font-semibold">{formatCurrency(calc.bestScenario.investDia)}/dia</span> (atual: {formatCurrency(calc.avgInvestDia)}) ·
                ROAS proj: {calc.bestScenario.roasEst.toFixed(1)}x ·
                MC% proj: {pct(calc.bestScenario.mcPosAdsEst)} ·
                Lucro/dia: <span className="text-success font-semibold">{formatCurrency(calc.bestScenario.lucroDia)}</span>
                {calc.bestScenario.cobreFixoEbitda
                  ? <span className="text-success ml-1">(cobre fixo + EBITDA)</span>
                  : <span className="text-warning ml-1">(nao cobre fixo + EBITDA)</span>
                }
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Daily Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Controle Diario</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Data</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Investimento</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Receita</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">% Ads</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">MC pre</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">MC pos-ads</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">Lucro Liquido</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {calc.enriched.map((d, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="px-3 py-2 text-right font-semibold">{d.date}</td>
                    <td className="px-3 py-2 text-right text-destructive">{formatCurrency(d.totalSpend)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(d.revenue)}</td>
                    <td className="px-3 py-2 text-right text-warning font-semibold">{pct(d.adsPct)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{pct(calc.mcPreAdsPct)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-bold ${d.mcPosAds >= 0.35 ? "text-success" : d.mcPosAds >= 0.25 ? "text-warning" : "text-destructive"}`}>
                        {pct(d.mcPosAds)}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${d.lucroLiquido >= 0 ? "text-success" : "text-destructive"}`}>
                      {formatCurrency(d.lucroLiquido)}
                    </td>
                    <td className="px-3 py-2 text-right text-blue-400 font-semibold">{d.roas.toFixed(2)}x</td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="border-t-2 border-border">
                  <td className="px-3 py-2.5 text-right font-black">TOTAL</td>
                  <td className="px-3 py-2.5 text-right text-destructive font-bold">{formatCurrency(calc.totalInvest)}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{formatCurrency(calc.totalReceita)}</td>
                  <td className="px-3 py-2.5 text-right text-warning font-bold">{pct(calc.adsPctGlobal)}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{pct(calc.mcPreAdsPct)}</td>
                  <td className="px-3 py-2.5 text-right text-success font-bold">{pct(calc.mcPosAdsGlobal)}</td>
                  <td className={`px-3 py-2.5 text-right font-black text-sm ${calc.totalLucro >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatCurrency(calc.totalLucro)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-blue-400 font-bold">{calc.avgRoas.toFixed(2)}x</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
