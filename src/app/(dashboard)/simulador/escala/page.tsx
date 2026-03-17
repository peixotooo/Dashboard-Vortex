"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, CheckCircle2, Target } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
  annual_revenue_target: number;
  invest_pct: number;
  frete_pct: number;
  desconto_pct: number;
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
  annual_revenue_target: 8000000,
  invest_pct: 12,
  frete_pct: 6,
  desconto_pct: 3,
  isDefault: true,
};

const EBITDA_MIN = 0.08;
const EBITDA_IDEAL = 0.10;

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
const fmtInt = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

function EbitdaTag({ value }: { value: number }) {
  const isIdeal = value >= EBITDA_IDEAL;
  const isOk = value >= EBITDA_MIN;
  const bg = isIdeal ? "bg-success/15" : isOk ? "bg-warning/15" : "bg-destructive/15";
  const color = isIdeal ? "text-success" : isOk ? "text-warning" : "text-destructive";
  const label = isIdeal ? "IDEAL" : isOk ? "OK" : "ABAIXO";
  return (
    <span className={`${bg} ${color} px-2.5 py-0.5 rounded text-[10px] font-bold`}>
      {pct(value)} · {label}
    </span>
  );
}

export default function EscalaPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<DailyRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [vndaShipping, setVndaShipping] = useState(0);
  const [vndaDiscount, setVndaDiscount] = useState(0);
  const [vndaConfigured, setVndaConfigured] = useState(false);
  const [ga4Configured, setGa4Configured] = useState(false);
  const [finSettings, setFinSettings] = useState<FinancialSettings>(FIN_DEFAULTS);
  const abortRef = useRef<AbortController | null>(null);
  const [simInvest, setSimInvest] = useState(3200);
  const [cpsDecay, setCpsDecay] = useState(15);   // % inflacao CPS ao dobrar invest
  const [convDecay, setConvDecay] = useState(10);  // % queda TX Conv ao dobrar invest

  useEffect(() => {
    if (!accountId || accounts.length === 0 || !workspace?.id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    async function fetchData() {
      setLoading(true);
      try {
        const datePreset = "last_30d";
        const accountIds = accountId === "all" ? accounts.map((a) => a.id) : [accountId];

        const vndaHeaders: Record<string, string> = { "x-workspace-id": workspace!.id };

        const [insightsResults, ga4Res, vndaRes, finRes] = await Promise.all([
          Promise.all(
            accountIds.map((id) =>
              fetch(`/api/insights?object_id=${id}&level=account&date_preset=${datePreset}`, { signal: controller.signal }).then((r) => r.json())
            )
          ),
          fetch(`/api/ga4/insights?date_preset=${datePreset}`, { signal: controller.signal }),
          fetch(`/api/vnda/insights?date_preset=${datePreset}`, { headers: vndaHeaders, signal: controller.signal }),
          fetch("/api/financial-settings", { headers: vndaHeaders, signal: controller.signal }),
        ]);

        const ga4Data = await ga4Res.json();
        const vndaData = await vndaRes.json();
        const settings: FinancialSettings = await finRes.json();
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
        const isGa4Configured = ga4Data.configured === true;
        setGa4Configured(isGa4Configured);
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

          const revenue = isVndaConfigured ? (vndaDay?.revenue ?? 0) : isGa4Configured ? (ga4Day?.revenue ?? 0) : (metaDay?.metaRevenue ?? 0);
          const transactions = isVndaConfigured ? (vndaDay?.orders ?? 0) : isGa4Configured ? (ga4Day?.transactions ?? 0) : (metaDay?.metaPurchases ?? 0);
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
        const rev = isVndaConfigured ? vndaTotals.revenue : isGa4Configured ? ga4Totals.revenue : totalMetaRevenue;
        setTotalRevenue(rev);
        // Total investment from last_30d (same as Overview)
        setTotalInvestment(totalSpend + gadsTotalCost);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    return () => { abortRef.current?.abort(); };
  }, [accountId, accounts, workspace?.id]);

  // --- Calculations ---
  const calc = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentMonthStr = String(currentMonth + 1).padStart(2, "0");
    const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
    const monthName = now.toLocaleString("pt-BR", { month: "long" }).replace(/^\w/, (c) => c.toUpperCase());

    const monthData = trendData.filter((d) => d.date.slice(3, 5) === currentMonthStr);
    const daysWithData = monthData.length;

    // Variable cost percentages (EXCLUDING ads) — usa premissas CONFIGURADAS (fixas no mês)
    const { tax_pct, product_cost_pct, other_expenses_pct, monthly_fixed_costs, monthly_seasonality,
            annual_revenue_target, invest_pct, frete_pct, desconto_pct } = finSettings;

    const custosSemAdsPct = (frete_pct + desconto_pct + tax_pct + product_cost_pct + other_expenses_pct) / 100;
    const mcPreAdsPct = 1 - custosSemAdsPct;
    const custoFixoDiario = daysInMonth > 0 ? monthly_fixed_costs / daysInMonth : 0;

    // Enrich daily data with EBITDA
    const enriched = monthData.map((d) => {
      const custosVar = d.revenue * custosSemAdsPct;
      const ebitda = d.revenue * mcPreAdsPct - d.totalSpend - custoFixoDiario;
      const ebitdaPct = d.revenue > 0 ? ebitda / d.revenue : 0;
      const adsPct = d.revenue > 0 ? d.totalSpend / d.revenue : 0;
      const roas = d.totalSpend > 0 ? d.revenue / d.totalSpend : 0;
      const receitaMin8 = mcPreAdsPct - EBITDA_MIN > 0 ? (d.totalSpend + custoFixoDiario) / (mcPreAdsPct - EBITDA_MIN) : 0;
      return { ...d, custosVar, ebitda, ebitdaPct, adsPct, roas, receitaMin8 };
    });

    // Totals
    const totalReceita = enriched.reduce((s, d) => s + d.revenue, 0);
    const totalInvest = enriched.reduce((s, d) => s + d.totalSpend, 0);
    const totalEbitda = enriched.reduce((s, d) => s + d.ebitda, 0);
    const ebitdaPctGlobal = totalReceita > 0 ? totalEbitda / totalReceita : 0;
    const avgReceitaDia = daysWithData > 0 ? totalReceita / daysWithData : 0;
    const avgInvestDia = daysWithData > 0 ? totalInvest / daysWithData : 0;
    const diasRestantes = daysInMonth - daysWithData;
    const projReceita = totalReceita + (avgReceitaDia * diasRestantes);
    const avgRoas = totalInvest > 0 ? totalReceita / totalInvest : 0;
    const totalSessions = enriched.reduce((s, d) => s + d.sessions, 0);
    const totalPedidos = enriched.reduce((s, d) => s + d.pedidos, 0);
    const avgTicket = totalPedidos > 0 ? totalReceita / totalPedidos : 0;
    const avgTxConv = totalSessions > 0 ? (totalPedidos / totalSessions) * 100 : 0;
    const avgCps = totalSessions > 0 ? totalInvest / totalSessions : 0;
    const diasAbaixo = enriched.filter((d) => d.ebitdaPct < EBITDA_MIN).length;

    // --- META: top-down, FIXA no mês ---
    const seasonalityWeight = (monthly_seasonality?.[currentMonth] ?? 8.33) / 100;
    const monthTarget = annual_revenue_target * seasonalityWeight;

    // --- PE: usa premissas CONFIGURADAS (fixas no mês) ---
    const totalVarCostPctConfig = invest_pct + frete_pct + desconto_pct + tax_pct + product_cost_pct + other_expenses_pct;
    const contributionMarginPct = 100 - totalVarCostPctConfig;
    const breakEven = contributionMarginPct > 0 ? monthly_fixed_costs / (contributionMarginPct / 100) : 0;

    // Pre/Post PE
    const aboveBreakEven = totalReceita >= breakEven;
    const marginAbovePE = totalReceita - breakEven;
    const diasParaPE = !aboveBreakEven && avgReceitaDia > 0
      ? Math.ceil((breakEven - totalReceita) / avgReceitaDia)
      : 0;
    const diasParaMeta = monthTarget > totalReceita && avgReceitaDia > 0
      ? Math.ceil((monthTarget - totalReceita) / avgReceitaDia)
      : 0;
    const mcPosAdsPct = totalReceita > 0 ? (totalReceita - totalReceita * custosSemAdsPct - totalInvest) / totalReceita : 0;

    // Accumulated revenue (with projection)
    const accumData: Array<{ dia: number; data: string; receitaAcum: number; projecao: boolean }> = [];
    let accReceita = 0;
    enriched.forEach((d, i) => {
      accReceita += d.revenue;
      accumData.push({ dia: i + 1, data: d.date, receitaAcum: accReceita, projecao: false });
    });
    const avgDia = daysWithData > 0 ? accReceita / daysWithData : 0;
    for (let i = daysWithData + 1; i <= daysInMonth; i++) {
      accReceita += avgDia;
      accumData.push({ dia: i, data: `${String(i).padStart(2, "0")}/${currentMonthStr}`, receitaAcum: accReceita, projecao: true });
    }

    // Scenario simulation (CPS-based com decaimento conservador)
    const cpsExp = Math.log2(1 + cpsDecay / 100);
    const convExp = Math.log2(1 + convDecay / 100);

    const simData: Array<{ invest: number; sessoes: number; pedidos: number; receitaDia: number; cpsAdj: number; txConvAdj: number; ebitda: number; ebitdaPct: number; receitaMes: number }> = [];
    if (avgCps > 0 && avgTxConv > 0 && avgTicket > 0) {
      for (let invest = 1000; invest <= 6000; invest += 100) {
        const ratio = avgInvestDia > 0 ? invest / avgInvestDia : 1;
        const cpsAdj = ratio > 1 ? avgCps * Math.pow(ratio, cpsExp) : avgCps;
        const txConvAdj = ratio > 1 ? avgTxConv * Math.pow(ratio, -convExp) : avgTxConv;

        const sessoes = invest / cpsAdj;
        const pedidos = sessoes * (txConvAdj / 100);
        const receitaDia = pedidos * avgTicket;
        const ebitda = receitaDia * mcPreAdsPct - invest - custoFixoDiario;
        const ebitdaPct = receitaDia > 0 ? ebitda / receitaDia : 0;
        const receitaMes = totalReceita + (receitaDia * diasRestantes);
        simData.push({ invest, sessoes, pedidos, receitaDia, cpsAdj, txConvAdj, ebitda, ebitdaPct, receitaMes });
      }
    }

    // Ponto otimo: max receita com EBITDA >= 8%
    const validScenarios = simData.filter((s) => s.ebitdaPct >= EBITDA_MIN);
    const pontoOtimo = validScenarios.length > 0
      ? validScenarios.reduce((best, s) => s.receitaDia > best.receitaDia ? s : best, validScenarios[0])
      : simData[0] ?? null;

    const progPE = breakEven > 0 ? Math.min((totalReceita / breakEven) * 100, 100) : 0;
    const progMeta = monthTarget > 0 ? Math.min((totalReceita / monthTarget) * 100, 100) : 0;

    return {
      monthName,
      mcPreAdsPct,
      custosSemAdsPct,
      custoFixoDiario,
      enriched,
      totalReceita,
      totalInvest,
      totalEbitda,
      ebitdaPctGlobal,
      avgReceitaDia,
      avgInvestDia,
      avgRoas,
      avgTicket,
      avgTxConv,
      avgCps,
      diasRestantes,
      daysWithData,
      daysInMonth,
      projReceita,
      diasAbaixo,
      breakEven,
      monthTarget,
      aboveBreakEven,
      marginAbovePE,
      diasParaPE,
      diasParaMeta,
      mcPosAdsPct,
      contributionMarginPct,
      accumData,
      simData,
      pontoOtimo,
      progPE,
      progMeta,
    };
  }, [trendData, finSettings, cpsDecay, convDecay]);

  // Slider simulation (CPS-based com decaimento)
  const simAtual = useMemo(() => {
    if (calc.avgCps <= 0 || calc.avgTxConv <= 0 || calc.avgTicket <= 0) return null;
    const cpsExp = Math.log2(1 + cpsDecay / 100);
    const convExp = Math.log2(1 + convDecay / 100);
    const ratio = calc.avgInvestDia > 0 ? simInvest / calc.avgInvestDia : 1;
    const cpsAdj = ratio > 1 ? calc.avgCps * Math.pow(ratio, cpsExp) : calc.avgCps;
    const txConvAdj = ratio > 1 ? calc.avgTxConv * Math.pow(ratio, -convExp) : calc.avgTxConv;
    const sessoes = simInvest / cpsAdj;
    const pedidos = sessoes * (txConvAdj / 100);
    const receitaDia = pedidos * calc.avgTicket;
    const ebitda = receitaDia * calc.mcPreAdsPct - simInvest - calc.custoFixoDiario;
    const ebitdaPct = receitaDia > 0 ? ebitda / receitaDia : 0;
    const receitaMes = calc.totalReceita + (receitaDia * calc.diasRestantes);
    return { sessoes, pedidos, cpsAdj, txConvAdj, receitaDia, ebitda, ebitdaPct, receitaMes };
  }, [simInvest, calc, cpsDecay, convDecay]);

  const revenueSource = vndaConfigured ? "VNDA" : ga4Configured ? "GA4" : "Meta";
  const revenueColor = vndaConfigured ? "#10b981" : ga4Configured ? "#f97316" : "#818cf8";

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Painel de Caixa
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  // PE position for visual bar (as % of Meta or max scale)
  const barScale = Math.max(calc.monthTarget, calc.projReceita, calc.breakEven) * 1.1;
  const peBarPct = barScale > 0 ? (calc.breakEven / barScale) * 100 : 0;
  const receitaBarPct = barScale > 0 ? (calc.totalReceita / barScale) * 100 : 0;
  const metaBarPct = barScale > 0 ? (calc.monthTarget / barScale) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-extrabold text-foreground">
          Painel de Caixa — {calc.monthName} {new Date().getFullYear()}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Objetivo: maximizar receita mantendo EBITDA entre 8% e 10%
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-2" style={{ color: revenueColor, backgroundColor: `${revenueColor}15` }}>
            Receita: {revenueSource}
          </span>
        </p>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-blue-500/[0.02]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-blue-500 mb-2">Receita Acumulada</p>
            <p className="text-2xl font-black text-foreground leading-none">{fmtK(calc.totalReceita)}</p>
            <p className="text-[11px] text-muted-foreground mt-2">media {fmtInt(calc.avgReceitaDia)}/dia</p>
          </CardContent>
        </Card>

        <Card className={calc.ebitdaPctGlobal >= EBITDA_MIN ? "border-success/20 bg-gradient-to-br from-success/10 to-success/[0.02]" : "border-destructive/20 bg-gradient-to-br from-destructive/10 to-destructive/[0.02]"}>
          <CardContent className="pt-5 pb-4">
            <p className={`text-[10px] font-bold uppercase tracking-[1.5px] mb-2 ${calc.ebitdaPctGlobal >= EBITDA_MIN ? "text-success" : "text-destructive"}`}>
              EBITDA % Periodo
            </p>
            <p className={`text-2xl font-black leading-none ${calc.ebitdaPctGlobal >= EBITDA_IDEAL ? "text-success" : calc.ebitdaPctGlobal >= EBITDA_MIN ? "text-warning" : "text-destructive"}`}>
              {pct(calc.ebitdaPctGlobal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">{fmtInt(calc.totalEbitda)} em {calc.daysWithData} dias</p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-purple-500/[0.02]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-purple-500 mb-2">EBITDA R$ Acum.</p>
            <p className={`text-2xl font-black leading-none ${calc.totalEbitda >= 0 ? "text-purple-500" : "text-destructive"}`}>
              {fmtInt(calc.totalEbitda)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              {calc.diasAbaixo > 0 ? `${calc.diasAbaixo} dia(s) abaixo de 8%` : "todos os dias acima de 8%"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-warning/20 bg-gradient-to-br from-warning/10 to-warning/[0.02]">
          <CardContent className="pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-warning mb-2">Invest. Otimo (Max Receita c/ 8%)</p>
            <p className="text-2xl font-black text-warning leading-none">
              {calc.pontoOtimo ? fmtInt(calc.pontoOtimo.invest) : "—"}<span className="text-sm text-muted-foreground">/dia</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">atual: {fmtInt(calc.avgInvestDia)}/dia</p>
          </CardContent>
        </Card>
      </div>

      {/* Progress PE + Meta */}
      <Card className="bg-muted/[0.02]">
        <CardContent className="pt-4 pb-4">
          <div className="mb-3.5">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-destructive font-semibold">PE: {fmtK(calc.breakEven)}</span>
              <span className="text-destructive">{calc.progPE.toFixed(0)}%</span>
            </div>
            <div className="h-2.5 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${calc.progPE >= 100 ? "bg-success" : "bg-destructive"}`}
                style={{ width: `${calc.progPE}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-blue-500 font-semibold">Meta: {fmtK(calc.monthTarget)}</span>
              <span className="text-blue-500">{calc.progMeta.toFixed(0)}%</span>
            </div>
            <div className="h-2.5 bg-muted/30 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${calc.progMeta}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pre/Post PE Section */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Pre e Pos Ponto de Equilibrio
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {/* Ate o PE */}
            <div className={`rounded-xl px-4 py-4 ${calc.aboveBreakEven ? "bg-success/[0.06] border border-success/20" : "bg-destructive/[0.06] border border-destructive/20"}`}>
              <div className="flex items-center gap-2 mb-2">
                {calc.aboveBreakEven
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : <Target className="h-4 w-4 text-destructive" />
                }
                <p className={`text-[10px] font-bold uppercase tracking-[1.5px] ${calc.aboveBreakEven ? "text-success" : "text-destructive"}`}>
                  Ate o PE ({fmtK(calc.breakEven)})
                </p>
              </div>
              {calc.aboveBreakEven ? (
                <>
                  <p className="text-lg font-black text-success">PE Atingido</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Custos fixos cobertos — cada R$ 1 de receita extra gera R$ {calc.mcPosAdsPct.toFixed(2)} de lucro
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-black text-destructive">Faltam {fmtK(calc.breakEven - calc.totalReceita)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    ~{calc.diasParaPE} dia(s) no ritmo atual ({fmtInt(calc.avgReceitaDia)}/dia)
                  </p>
                </>
              )}
            </div>

            {/* Apos o PE → Meta */}
            <div className={`rounded-xl px-4 py-4 ${calc.totalReceita >= calc.monthTarget ? "bg-blue-500/[0.06] border border-blue-500/20" : "bg-muted/[0.06] border border-border/20"}`}>
              <div className="flex items-center gap-2 mb-2">
                {calc.totalReceita >= calc.monthTarget
                  ? <CheckCircle2 className="h-4 w-4 text-blue-500" />
                  : <Target className="h-4 w-4 text-blue-500" />
                }
                <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-blue-500">
                  Meta ({fmtK(calc.monthTarget)})
                </p>
              </div>
              {calc.totalReceita >= calc.monthTarget ? (
                <>
                  <p className="text-lg font-black text-blue-500">Meta Atingida</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {fmtK(calc.totalReceita - calc.monthTarget)} acima da meta
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-black text-foreground">Faltam {fmtK(calc.monthTarget - calc.totalReceita)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    ~{calc.diasParaMeta} dia(s) no ritmo atual
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Visual bar */}
          <div className="relative h-6 bg-muted/20 rounded-full overflow-visible">
            {/* PE marker */}
            <div className="absolute top-0 h-full" style={{ left: `${peBarPct}%` }}>
              <div className="h-full w-0.5 bg-destructive" />
              <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-destructive font-bold whitespace-nowrap">PE</span>
            </div>
            {/* Meta marker */}
            <div className="absolute top-0 h-full" style={{ left: `${metaBarPct}%` }}>
              <div className="h-full w-0.5 bg-blue-500" />
              <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-blue-500 font-bold whitespace-nowrap">Meta</span>
            </div>
            {/* Receita fill */}
            <div
              className={`h-full rounded-full transition-all ${
                calc.totalReceita >= calc.monthTarget ? "bg-blue-500" :
                calc.aboveBreakEven ? "bg-success" : "bg-destructive"
              }`}
              style={{ width: `${Math.min(receitaBarPct, 100)}%` }}
            />
            {/* Receita label */}
            <span
              className="absolute -bottom-4 text-[9px] font-bold text-foreground whitespace-nowrap"
              style={{ left: `${Math.min(receitaBarPct, 95)}%`, transform: "translateX(-50%)" }}
            >
              {fmtK(calc.totalReceita)}
            </span>
          </div>
          <div className="h-4" />
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Receita Acumulada no Mes */}
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3.5">
              Receita Acumulada no Mes
            </h3>
            <div className="h-[220px]" style={{ overflow: "visible" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={calc.accumData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="dia" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 50 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as { dia: number; projecao: boolean; receitaAcum: number };
                      if (!d) return null;
                      return (
                        <div className="bg-[rgba(10,10,20,0.96)] border border-border/30 rounded-xl px-4 py-3 text-[13px]">
                          <div className="text-foreground font-bold">Dia {d.dia} {d.projecao ? "(projecao)" : ""}</div>
                          <div className="text-foreground mt-1">Receita acum: {fmtK(d.receitaAcum)}</div>
                        </div>
                      );
                    }}
                  />
                  {calc.breakEven > 0 && (
                    <ReferenceLine y={calc.breakEven} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={2} label={{ value: "PE", fill: "#ef4444", fontSize: 10, position: "right" }} />
                  )}
                  {calc.monthTarget > 0 && (
                    <ReferenceLine y={calc.monthTarget} stroke="#3b82f6" strokeDasharray="6 4" strokeWidth={2} label={{ value: "Meta", fill: "#3b82f6", fontSize: 10, position: "right" }} />
                  )}
                  <Area type="monotone" dataKey="receitaAcum" stroke="#22c55e" fill="rgba(34,197,94,0.1)" strokeWidth={2.5} name="Receita" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-5 justify-center mt-1.5 text-[10px]">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-success inline-block rounded" /> Receita acumulada</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-destructive inline-block rounded" style={{ borderTop: "2px dashed #ef4444", height: 0 }} /> PE ({fmtK(calc.breakEven)})</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block rounded" style={{ borderTop: "2px dashed #3b82f6", height: 0 }} /> Meta ({fmtK(calc.monthTarget)})</span>
            </div>
          </CardContent>
        </Card>

        {/* EBITDA R$ por Dia */}
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3.5">
              EBITDA R$ por Dia
            </h3>
            <div className="h-[220px]" style={{ overflow: "visible" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calc.enriched} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="date" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                  <Tooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 50 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as typeof calc.enriched[number];
                      if (!d) return null;
                      return (
                        <div className="bg-[rgba(10,10,20,0.96)] border border-border/30 rounded-xl px-4 py-3.5 text-[13px] leading-[1.7] min-w-[260px]">
                          <div className="text-foreground font-bold text-sm mb-1.5">{d.date}</div>
                          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                            <span className="text-muted-foreground">Receita</span>
                            <span className="text-foreground text-right">{formatCurrency(d.revenue)}</span>
                            <span className="text-muted-foreground">Custos var. ({pct(calc.custosSemAdsPct)})</span>
                            <span className="text-warning text-right">-{formatCurrency(d.custosVar)}</span>
                            <span className="text-muted-foreground">Ads ({pct(d.adsPct)})</span>
                            <span className="text-destructive text-right">-{formatCurrency(d.totalSpend)}</span>
                            <span className="text-muted-foreground">Custo fixo/dia</span>
                            <span className="text-muted-foreground text-right">-{formatCurrency(calc.custoFixoDiario)}</span>
                          </div>
                          <div className="border-t border-border/20 mt-2 pt-2">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">EBITDA</span>
                              <span className={`font-extrabold text-[15px] ${d.ebitda >= 0 ? "text-success" : "text-destructive"}`}>
                                {formatCurrency(d.ebitda)} ({pct(d.ebitdaPct)})
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1">
                              Precisava {formatCurrency(d.receitaMin8)} pra 8% de EBITDA
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
                  <Bar dataKey="ebitda" radius={[4, 4, 0, 0]}>
                    {calc.enriched.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.ebitdaPct >= EBITDA_IDEAL ? "rgba(34,197,94,0.75)" :
                          d.ebitdaPct >= EBITDA_MIN ? "rgba(245,158,11,0.6)" :
                          "rgba(239,68,68,0.7)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-5 justify-center mt-1.5 text-[10px]">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "rgba(34,197,94,0.75)" }} /> EBITDA {">"}= 10%</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "rgba(245,158,11,0.6)" }} /> 8-10%</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "rgba(239,68,68,0.7)" }} /> {"<"} 8%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Simulador */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Simulador: Ate onde posso investir?
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-muted-foreground">
            <span>Parametros base: <span className="font-semibold text-foreground">CPS {formatCurrency(calc.avgCps)}</span> · <span className="font-semibold text-foreground">TX Conv {calc.avgTxConv.toFixed(2)}%</span> · <span className="font-semibold text-foreground">Ticket {formatCurrency(calc.avgTicket)}</span> · <span className="font-semibold text-foreground">Invest. atual {fmtInt(calc.avgInvestDia)}/dia</span></span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-[11px]">
            <span className="text-muted-foreground">Ajuste de escala:</span>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Inflacao CPS ao 2x</span>
              <input
                type="number"
                min={0}
                max={50}
                step={1}
                value={cpsDecay}
                onChange={(e) => setCpsDecay(Math.max(0, Math.min(50, Number(e.target.value))))}
                className="w-12 bg-muted/20 border border-border/30 rounded px-1.5 py-0.5 text-center text-foreground font-semibold text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-muted-foreground">%</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Queda TX Conv ao 2x</span>
              <input
                type="number"
                min={0}
                max={50}
                step={1}
                value={convDecay}
                onChange={(e) => setConvDecay(Math.max(0, Math.min(50, Number(e.target.value))))}
                className="w-12 bg-muted/20 border border-border/30 rounded px-1.5 py-0.5 text-center text-foreground font-semibold text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-muted-foreground">%</span>
            </label>
          </div>
          <div className="bg-muted/[0.04] rounded-lg px-3.5 py-2.5 mb-5 text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Como e calculado: </span>
            Invest ÷ CPS = <span className="text-foreground">Sessoes</span> → × TX Conv = <span className="text-foreground">Pedidos</span> → × Ticket = <span className="text-foreground">Receita</span> → × MC pre-ads - Invest - Fixo/dia = <span className="text-foreground">EBITDA</span>.
            {(cpsDecay > 0 || convDecay > 0) && (
              <span className="ml-1">Acima de {fmtInt(calc.avgInvestDia)}/dia, CPS sobe {cpsDecay}% e TX Conv cai {convDecay}% a cada 2x de budget (retornos decrescentes).</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 items-start">
            <div>
              <div className="mb-5">
                <p className="text-[11px] text-muted-foreground mb-2">Investimento/dia</p>
                <p className="text-3xl font-black text-foreground mb-3">
                  {fmtInt(simInvest)}<span className="text-sm text-muted-foreground">/dia</span>
                </p>
                <input
                  type="range"
                  min={1000}
                  max={6000}
                  step={100}
                  value={simInvest}
                  onChange={(e) => setSimInvest(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>R$ 1.000</span>
                  <span>R$ 6.000</span>
                </div>
              </div>

              {simAtual && (
                <div className="grid gap-2.5">
                  <div className="bg-muted/[0.06] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Sessoes/dia</p>
                    <p className="text-lg font-extrabold text-foreground">{Math.round(simAtual.sessoes).toLocaleString("pt-BR")}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {fmtInt(simInvest)} / {formatCurrency(simAtual.cpsAdj)} CPS
                      {simAtual.cpsAdj > calc.avgCps && <span className="text-warning ml-1">(+{(((simAtual.cpsAdj / calc.avgCps) - 1) * 100).toFixed(0)}%)</span>}
                    </p>
                  </div>
                  <div className="bg-muted/[0.06] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Pedidos/dia</p>
                    <p className="text-lg font-extrabold text-foreground">{simAtual.pedidos.toFixed(1)}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {Math.round(simAtual.sessoes)} sessoes x {simAtual.txConvAdj.toFixed(2)}% conv
                      {simAtual.txConvAdj < calc.avgTxConv && <span className="text-warning ml-1">({(((simAtual.txConvAdj / calc.avgTxConv) - 1) * 100).toFixed(0)}%)</span>}
                    </p>
                  </div>
                  <div className="bg-muted/[0.06] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Receita/dia</p>
                    <p className="text-xl font-extrabold text-foreground">{fmtInt(simAtual.receitaDia)}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{simAtual.pedidos.toFixed(1)} ped x {formatCurrency(calc.avgTicket)} ticket</p>
                  </div>
                  <div className="bg-muted/[0.06] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] text-muted-foreground mb-1">EBITDA</p>
                    <p className={`text-xl font-extrabold ${simAtual.ebitdaPct >= EBITDA_IDEAL ? "text-success" : simAtual.ebitdaPct >= EBITDA_MIN ? "text-warning" : "text-destructive"}`}>
                      {pct(simAtual.ebitdaPct)} <span className="text-sm">({fmtInt(simAtual.ebitda)}/dia)</span>
                    </p>
                    <p className="text-[10px] mt-1">
                      {simAtual.ebitdaPct >= EBITDA_IDEAL
                        ? <span className="text-success">Dentro do ideal</span>
                        : simAtual.ebitdaPct >= EBITDA_MIN
                        ? <span className="text-warning">OK, mas no limite</span>
                        : <span className="text-destructive">Abaixo do minimo!</span>
                      }
                    </p>
                  </div>
                  <div className="bg-muted/[0.06] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Projecao receita mes</p>
                    <p className={`text-xl font-extrabold ${simAtual.receitaMes >= calc.breakEven ? "text-blue-500" : "text-destructive"}`}>
                      {fmtK(simAtual.receitaMes)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Dual-axis chart */}
            <div>
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={calc.simData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis
                      dataKey="invest"
                      tick={{ fill: "#555", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                      label={{ value: "Investimento/dia", position: "insideBottom", offset: -5, fill: "#555", fontSize: 10 }}
                    />
                    <YAxis
                      yAxisId="receita"
                      tick={{ fill: "#555", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="ebitda"
                      orientation="right"
                      tick={{ fill: "#555", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                    />
                    <Tooltip
                      allowEscapeViewBox={{ x: true, y: true }}
                      wrapperStyle={{ zIndex: 50 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload as typeof calc.simData[number];
                        if (!d) return null;
                        const cpsChanged = d.cpsAdj > calc.avgCps;
                        const txChanged = d.txConvAdj < calc.avgTxConv;
                        return (
                          <div className="bg-[rgba(10,10,20,0.96)] border border-border/30 rounded-xl px-4 py-3.5 text-[13px] min-w-[260px]">
                            <div className="text-foreground font-bold mb-1.5">Investindo {fmtInt(d.invest)}/dia</div>
                            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[12px]">
                              <span className="text-muted-foreground">CPS</span>
                              <span className="text-foreground text-right">
                                {formatCurrency(d.cpsAdj)}
                                {cpsChanged && <span className="text-warning ml-1 text-[10px]">(+{(((d.cpsAdj / calc.avgCps) - 1) * 100).toFixed(0)}%)</span>}
                              </span>
                              <span className="text-muted-foreground">TX Conv</span>
                              <span className="text-foreground text-right">
                                {d.txConvAdj.toFixed(2)}%
                                {txChanged && <span className="text-warning ml-1 text-[10px]">({(((d.txConvAdj / calc.avgTxConv) - 1) * 100).toFixed(0)}%)</span>}
                              </span>
                              <span className="text-muted-foreground">Sessoes</span>
                              <span className="text-foreground text-right">{Math.round(d.sessoes).toLocaleString("pt-BR")}</span>
                              <span className="text-muted-foreground">Pedidos</span>
                              <span className="text-foreground text-right">{d.pedidos.toFixed(1)}</span>
                              <span className="text-muted-foreground">Receita/dia</span>
                              <span className="text-blue-500 text-right font-semibold">{fmtInt(d.receitaDia)}</span>
                            </div>
                            <div className="border-t border-border/20 mt-1.5 pt-1.5">
                              <div className={`font-bold ${d.ebitdaPct >= EBITDA_MIN ? "text-success" : "text-destructive"}`}>
                                EBITDA: {pct(d.ebitdaPct)} ({fmtInt(d.ebitda)}/dia)
                              </div>
                              <div className="text-muted-foreground text-[11px] mt-0.5">
                                Receita mes: {fmtK(d.receitaMes)}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine yAxisId="ebitda" y={EBITDA_IDEAL} stroke="#22c55e" strokeDasharray="6 4" label={{ value: "10%", fill: "#22c55e", fontSize: 10, position: "left" }} />
                    <ReferenceLine yAxisId="ebitda" y={EBITDA_MIN} stroke="#f59e0b" strokeDasharray="6 4" label={{ value: "8%", fill: "#f59e0b", fontSize: 10, position: "left" }} />
                    <ReferenceLine yAxisId="ebitda" y={0} stroke="rgba(239,68,68,0.4)" strokeWidth={1.5} />
                    {calc.avgInvestDia > 0 && (
                      <ReferenceLine x={Math.round(calc.avgInvestDia / 100) * 100} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "ATUAL", fill: "#f59e0b", fontSize: 10, position: "top" }} />
                    )}
                    {calc.pontoOtimo && (
                      <ReferenceLine x={calc.pontoOtimo.invest} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "OTIMO", fill: "#22c55e", fontSize: 10, position: "top" }} />
                    )}
                    <Area yAxisId="receita" type="monotone" dataKey="receitaDia" fill="rgba(59,130,246,0.06)" stroke="none" />
                    <Line yAxisId="receita" type="monotone" dataKey="receitaDia" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Receita/dia" />
                    <Line yAxisId="ebitda" type="monotone" dataKey="ebitdaPct" stroke="#22c55e" strokeWidth={2} dot={false} strokeDasharray="4 2" name="EBITDA %" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-5 justify-center mt-2 text-[11px]">
                <span className="text-blue-500">━ Receita/dia (eixo esq.)</span>
                <span className="text-success">╌ EBITDA % (eixo dir.)</span>
                <span className="text-warning">┊ Investimento atual</span>
                <span className="text-success">┊ Ponto otimo</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela Controle Diario */}
      <Card>
        <CardContent className="pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3.5">
            Controle Diario
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Data", "Receita", "Custos Var.", "Ads", "Fixo/dia", "EBITDA R$", "EBITDA %", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-semibold text-muted-foreground text-[10px] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calc.enriched.map((d, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-muted/5">
                    <td className="px-3 py-2.5 text-right font-semibold text-foreground">{d.date}</td>
                    <td className="px-3 py-2.5 text-right text-foreground">{formatCurrency(d.revenue)}</td>
                    <td className="px-3 py-2.5 text-right text-warning">-{formatCurrency(d.custosVar)}</td>
                    <td className="px-3 py-2.5 text-right text-destructive">-{formatCurrency(d.totalSpend)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">-{formatCurrency(calc.custoFixoDiario)}</td>
                    <td className={`px-3 py-2.5 text-right font-extrabold ${d.ebitda >= 0 ? "text-success" : "text-destructive"}`}>
                      {formatCurrency(d.ebitda)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold ${d.ebitdaPct >= EBITDA_IDEAL ? "text-success" : d.ebitdaPct >= EBITDA_MIN ? "text-warning" : "text-destructive"}`}>
                      {pct(d.ebitdaPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right"><EbitdaTag value={d.ebitdaPct} /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border">
                  <td className="px-3 py-3 text-right font-black text-foreground">TOTAL</td>
                  <td className="px-3 py-3 text-right font-extrabold text-foreground">{formatCurrency(calc.totalReceita)}</td>
                  <td className="px-3 py-3 text-right font-bold text-warning">-{formatCurrency(calc.totalReceita * calc.custosSemAdsPct)}</td>
                  <td className="px-3 py-3 text-right font-bold text-destructive">-{formatCurrency(calc.totalInvest)}</td>
                  <td className="px-3 py-3 text-right font-bold text-muted-foreground">-{formatCurrency(calc.custoFixoDiario * calc.daysWithData)}</td>
                  <td className={`px-3 py-3 text-right font-black text-sm ${calc.totalEbitda >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatCurrency(calc.totalEbitda)}
                  </td>
                  <td className={`px-3 py-3 text-right font-extrabold ${calc.ebitdaPctGlobal >= EBITDA_IDEAL ? "text-success" : calc.ebitdaPctGlobal >= EBITDA_MIN ? "text-warning" : "text-destructive"}`}>
                    {pct(calc.ebitdaPctGlobal)}
                  </td>
                  <td className="px-3 py-3 text-right"><EbitdaTag value={calc.ebitdaPctGlobal} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Regra de Decisao */}
      <Card className="bg-muted/[0.04]">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Regra: </strong>
            <span className="text-success">EBITDA acima de 10% </span>→ pode investir mais, esta sobrando margem.
            <span className="text-warning"> EBITDA entre 8% e 10% </span>→ no ponto, mantem.
            <span className="text-destructive"> EBITDA abaixo de 8% </span>→ recua investimento.
            O objetivo e empurrar a receita ao maximo mantendo o EBITDA na faixa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
