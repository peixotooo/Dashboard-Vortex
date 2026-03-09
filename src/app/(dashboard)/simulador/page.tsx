"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  DollarSign,
  TrendingUp,
  Target,
  ShoppingCart,
  Calculator,
  AlertTriangle,
  CheckCircle,
  BarChart3,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import type { DatePreset } from "@/lib/types";

// --- Types ---

interface BaseData {
  investmentPerMonth: number;
  revenuePerMonth: number;
  roas: number;
  ordersPerMonth: number;
  ticketMedio: number;
  fretePerc: number;
  descontoPerc: number;
}

interface ProjectionRow {
  monthLabel: string;
  invest: number;
  roas: number;
  receita: number;
  pedidos: number;
  ticketMedio: number;
  frete: number;
  desconto: number;
  impostos: number;
  custoProduto: number;
  outrasDesp: number;
  totalCustosVar: number;
  margem: number;
  margemPerc: number;
  custosFixos: number;
  ebitda: number;
  ebitdaPerc: number;
}

// --- Helpers ---

function extractActionValue(
  actionValues: Array<{ action_type: string; value: string }> | undefined,
  type: string
): number {
  if (!actionValues) return 0;
  const action = actionValues.find((a) => a.action_type === type);
  return action ? parseFloat(action.value || "0") : 0;
}

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// --- Scenarios ---

const SCENARIOS = {
  conservador: { label: "Conservador", crescInvest: 5, varRoas: -10 },
  realista: { label: "Realista", crescInvest: 10, varRoas: -5 },
  otimista: { label: "Otimista", crescInvest: 20, varRoas: 0 },
} as const;

// --- Component ---

export default function SimuladorPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(true);
  const [activeScenario, setActiveScenario] = useState<string>("realista");

  // Base data from APIs
  const [baseData, setBaseData] = useState<BaseData>({
    investmentPerMonth: 0,
    revenuePerMonth: 0,
    roas: 0,
    ordersPerMonth: 0,
    ticketMedio: 0,
    fretePerc: 0,
    descontoPerc: 0,
  });

  // Projection inputs
  const [meses, setMeses] = useState(3);
  const [crescInvest, setCrescInvest] = useState(10);
  const [varRoas, setVarRoas] = useState(-5);
  const [impostosPerc, setImpostosPerc] = useState(6);
  const [custoProdPerc, setCustoProdPerc] = useState(25);
  const [outrasDespPerc, setOutrasDespPerc] = useState(5);
  const [custosFixos, setCustosFixos] = useState(160000);

  // Fetch financial settings from config
  useEffect(() => {
    if (!workspace?.id) return;

    async function fetchFinSettings() {
      try {
        const res = await fetch("/api/financial-settings", {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        if (!data.error) {
          setCustosFixos(data.monthly_fixed_costs ?? 160000);
          setImpostosPerc(data.tax_pct ?? 6);
          setCustoProdPerc(data.product_cost_pct ?? 25);
          setOutrasDespPerc(data.other_expenses_pct ?? 5);
        }
      } catch {
        // Keep defaults
      }
    }

    fetchFinSettings();
  }, [workspace?.id]);

  // Fetch real data
  useEffect(() => {
    if (!accountId) return;

    async function fetchData() {
      setLoading(true);
      try {
        const accountIds =
          accountId === "all"
            ? accounts.map((a) => a.id)
            : [accountId];

        const vndaHeaders: Record<string, string> = {};
        if (workspace?.id) vndaHeaders["x-workspace-id"] = workspace.id;

        const [insightsResults, ga4Res, vndaRes] = await Promise.all([
          Promise.all(
            accountIds.map((id) =>
              fetch(
                `/api/insights?object_id=${id}&level=account&date_preset=${datePreset}`
              ).then((r) => r.json())
            )
          ),
          fetch(`/api/ga4/insights?date_preset=${datePreset}`),
          fetch(`/api/vnda/insights?date_preset=${datePreset}`, {
            headers: vndaHeaders,
          }),
        ]);

        const ga4Data = await ga4Res.json();
        const vndaData = await vndaRes.json();

        // Aggregate Meta spend
        let totalSpend = 0;
        let totalMetaRevenue = 0;
        let totalMetaPurchases = 0;
        for (const insightsData of insightsResults) {
          const metaInsights = insightsData.insights || [];
          for (const row of metaInsights) {
            totalSpend += parseFloat((row.spend as string) || "0");
            const actionValues = row.action_values as
              | Array<{ action_type: string; value: string }>
              | undefined;
            totalMetaRevenue += extractActionValue(actionValues, "purchase");
            const actions = row.actions as
              | Array<{ action_type: string; value: string }>
              | undefined;
            if (actions) {
              const p = actions.find((a) => a.action_type === "purchase");
              totalMetaPurchases += p ? parseFloat(p.value || "0") : 0;
            }
          }
        }

        // Google Ads cost
        const googleAdsCost: number =
          ga4Data.googleAds?.totals?.cost || 0;
        const totalInvestment = totalSpend + googleAdsCost;

        // GA4 totals
        const ga4Configured = ga4Data.configured === true;
        const ga4Totals = ga4Data.totals || {};

        // VNDA totals
        const vndaConfigured = vndaData.configured === true;
        const vndaTotals = vndaData.totals || {};

        // Revenue priority: VNDA > GA4 > Meta
        const revenue = vndaConfigured
          ? vndaTotals.revenue || 0
          : ga4Configured
            ? ga4Totals.revenue || 0
            : totalMetaRevenue;

        const orders = vndaConfigured
          ? vndaTotals.orders || 0
          : ga4Configured
            ? ga4Totals.transactions || 0
            : totalMetaPurchases;

        const shipping = vndaTotals.shipping || 0;
        const discount = vndaTotals.discount || 0;

        // Calculate days in period for monthly normalization
        const daysMap: Record<string, number> = {
          today: 1,
          yesterday: 1,
          last_7d: 7,
          last_14d: 14,
          last_30d: 30,
          last_90d: 90,
          this_month: new Date().getDate(),
          last_month: new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            0
          ).getDate(),
        };
        const days = daysMap[datePreset] || 30;
        const monthMultiplier = 30 / days;

        const investPerMonth = totalInvestment * monthMultiplier;
        const revenuePerMonth = revenue * monthMultiplier;
        const ordersPerMonth = orders * monthMultiplier;
        const roas = totalInvestment > 0 ? revenue / totalInvestment : 0;
        const ticketMedio = orders > 0 ? revenue / orders : 0;
        const fretePerc = revenue > 0 ? (shipping / revenue) * 100 : 0;
        const descontoPerc = revenue > 0 ? (discount / revenue) * 100 : 0;

        setBaseData({
          investmentPerMonth: investPerMonth,
          revenuePerMonth,
          roas,
          ordersPerMonth,
          ticketMedio,
          fretePerc,
          descontoPerc,
        });
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [datePreset, accountId, accounts, workspace?.id]);

  // Apply scenario
  function applyScenario(key: string) {
    const s = SCENARIOS[key as keyof typeof SCENARIOS];
    if (!s) return;
    setCrescInvest(s.crescInvest);
    setVarRoas(s.varRoas);
    setActiveScenario(key);
  }

  // Projection calculation
  const projection = useMemo<ProjectionRow[]>(() => {
    const rows: ProjectionRow[] = [];
    const now = new Date();

    for (let i = 1; i <= meses; i++) {
      const monthIndex = (now.getMonth() + i) % 12;
      const invest =
        baseData.investmentPerMonth * Math.pow(1 + crescInvest / 100, i);
      const roas = baseData.roas * Math.pow(1 + varRoas / 100, i);
      const receita = invest * roas;
      const pedidos =
        baseData.ticketMedio > 0 ? receita / baseData.ticketMedio : 0;
      const frete = receita * (baseData.fretePerc / 100);
      const desconto = receita * (baseData.descontoPerc / 100);
      const impostos = receita * (impostosPerc / 100);
      const custoProduto = receita * (custoProdPerc / 100);
      const outrasDesp = receita * (outrasDespPerc / 100);
      const totalCustosVar =
        invest + frete + desconto + impostos + custoProduto + outrasDesp;
      const margem = receita - totalCustosVar;
      const margemPerc = receita > 0 ? (margem / receita) * 100 : 0;
      const ebitda = margem - custosFixos;
      const ebitdaPerc = receita > 0 ? (ebitda / receita) * 100 : 0;

      rows.push({
        monthLabel: MONTH_NAMES[monthIndex],
        invest,
        roas,
        receita,
        pedidos,
        ticketMedio: baseData.ticketMedio,
        frete,
        desconto,
        impostos,
        custoProduto,
        outrasDesp,
        totalCustosVar,
        margem,
        margemPerc,
        custosFixos,
        ebitda,
        ebitdaPerc,
      });
    }
    return rows;
  }, [
    meses,
    crescInvest,
    varRoas,
    impostosPerc,
    custoProdPerc,
    outrasDespPerc,
    custosFixos,
    baseData,
  ]);

  // Summary metrics
  const summary = useMemo(() => {
    const totalReceita = projection.reduce((s, r) => s + r.receita, 0);
    const totalInvest = projection.reduce((s, r) => s + r.invest, 0);
    const totalEbitda = projection.reduce((s, r) => s + r.ebitda, 0);
    const avgEbitdaPerc =
      projection.length > 0
        ? projection.reduce((s, r) => s + r.ebitdaPerc, 0) / projection.length
        : 0;
    const mesesLucrativos = projection.filter((r) => r.ebitda > 0).length;
    const roasFirst = projection[0]?.roas || 0;
    const roasLast = projection[projection.length - 1]?.roas || 0;

    // Recommendations
    const recs: string[] = [];
    const roasBelow2 = projection.findIndex((r) => r.roas < 2);
    if (roasBelow2 >= 0) {
      recs.push(
        `ROAS cai abaixo de 2x no mês ${roasBelow2 + 1} (${projection[roasBelow2].monthLabel}) — considere reduzir escala de investimento`
      );
    }
    if (avgEbitdaPerc < 5) {
      recs.push(
        "EBITDA % médio abaixo de 5% — revise custos variáveis ou aumente ticket médio"
      );
    }
    if (mesesLucrativos < projection.length && projection.length > 0) {
      recs.push(
        `${projection.length - mesesLucrativos} mês(es) com EBITDA negativo — atenção ao ponto de equilíbrio`
      );
    }
    const investPercReceita =
      totalReceita > 0 ? (totalInvest / totalReceita) * 100 : 0;
    if (investPercReceita > 30) {
      recs.push(
        `Investimento em ads representa ${investPercReceita.toFixed(0)}% da receita — considere otimizar CAC`
      );
    }
    if (recs.length === 0) {
      recs.push(
        "Cenário saudável — ROAS estável e margens positivas em todos os meses"
      );
    }

    return {
      totalReceita,
      totalInvest,
      totalEbitda,
      avgEbitdaPerc,
      mesesLucrativos,
      roasFirst,
      roasLast,
      recs,
    };
  }, [projection]);

  // Health color
  const healthColor =
    summary.avgEbitdaPerc > 15
      ? "text-success"
      : summary.avgEbitdaPerc > 5
        ? "text-warning"
        : "text-destructive";
  const healthLabel =
    summary.avgEbitdaPerc > 15
      ? "Saudável"
      : summary.avgEbitdaPerc > 5
        ? "Atenção"
        : "Crítico";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Simulador Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Projeção de DRE com dados reais como base
          </p>
        </div>
        <DateRangePicker value={datePreset} onChange={setDatePreset} />
      </div>

      {/* Base Data KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Invest./mês"
          value={formatCurrency(baseData.investmentPerMonth)}
          icon={DollarSign}
          iconColor="text-success"
          loading={loading}
          badge="Base"
          badgeColor="#22c55e"
        />
        <KpiCard
          title="Receita/mês"
          value={formatCurrency(baseData.revenuePerMonth)}
          icon={TrendingUp}
          iconColor="text-blue-400"
          loading={loading}
          badge="Base"
          badgeColor="#3b82f6"
        />
        <KpiCard
          title="ROAS Atual"
          value={`${baseData.roas.toFixed(2)}x`}
          icon={Target}
          iconColor="text-purple-400"
          loading={loading}
          badge="Base"
          badgeColor="#8b5cf6"
        />
        <KpiCard
          title="Ticket Médio"
          value={formatCurrency(baseData.ticketMedio)}
          icon={ShoppingCart}
          iconColor="text-warning"
          loading={loading}
          badge="Base"
          badgeColor="#f59e0b"
        />
      </div>

      {/* Scenario Buttons */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          Cenário:
        </span>
        {Object.entries(SCENARIOS).map(([key, s]) => (
          <button
            key={key}
            onClick={() => applyScenario(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              activeScenario === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Projection Inputs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros de Projeção</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Column 1: Projection */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Projeção
              </h4>
              <InputField
                label="Meses"
                value={meses}
                onChange={setMeses}
                min={1}
                max={12}
                step={1}
              />
              <InputField
                label="Cresc. Invest/mês (%)"
                value={crescInvest}
                onChange={(v) => {
                  setCrescInvest(v);
                  setActiveScenario("");
                }}
                step={1}
                suffix="%"
              />
              <InputField
                label="Var. ROAS/mês (%)"
                value={varRoas}
                onChange={(v) => {
                  setVarRoas(v);
                  setActiveScenario("");
                }}
                step={1}
                suffix="%"
              />
            </div>

            {/* Column 2: Variable Costs */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Custos Variáveis
              </h4>
              <InputField
                label="Frete (%)"
                value={parseFloat(baseData.fretePerc.toFixed(2))}
                onChange={() => {}}
                readonly
                suffix="%"
                badge="Real"
              />
              <InputField
                label="Descontos (%)"
                value={parseFloat(baseData.descontoPerc.toFixed(2))}
                onChange={() => {}}
                readonly
                suffix="%"
                badge="Real"
              />
              <InputField
                label="Impostos (%)"
                value={impostosPerc}
                onChange={setImpostosPerc}
                step={0.5}
                suffix="%"
              />
              <InputField
                label="Custo Produto (%)"
                value={custoProdPerc}
                onChange={setCustoProdPerc}
                step={0.5}
                suffix="%"
              />
              <InputField
                label="Outras Desp. (%)"
                value={outrasDespPerc}
                onChange={setOutrasDespPerc}
                step={0.5}
                suffix="%"
              />
            </div>

            {/* Column 3: Fixed Costs */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Custos Fixos
              </h4>
              <InputField
                label="Custos Fixos/mês (R$)"
                value={custosFixos}
                onChange={setCustosFixos}
                step={1000}
                prefix="R$"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DRE Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">DRE Projetada</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 pl-6 text-xs font-semibold text-muted-foreground w-56">
                    &nbsp;
                  </th>
                  {projection.map((row) => (
                    <th
                      key={row.monthLabel}
                      className="text-right p-3 text-xs font-semibold text-muted-foreground min-w-[120px]"
                    >
                      {row.monthLabel}
                    </th>
                  ))}
                  <th className="text-right p-3 pr-6 text-xs font-semibold text-primary min-w-[120px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* RECEITA */}
                <SectionHeader
                  label="RECEITA"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="Receita Total"
                  values={projection.map((r) => r.receita)}
                  format="currency"
                />
                <DreRow
                  label="Pedidos"
                  values={projection.map((r) => r.pedidos)}
                  format="number"
                  hideTotal
                />
                <DreRow
                  label="Ticket Médio"
                  values={projection.map((r) => r.ticketMedio)}
                  format="currency"
                  hideTotal
                />

                {/* CUSTOS VARIAVEIS */}
                <SectionHeader
                  label="CUSTOS VARIÁVEIS"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="Investimento Ads"
                  values={projection.map((r) => r.invest)}
                  format="currency"
                  negative
                />
                <DreRow
                  label={`Frete (${baseData.fretePerc.toFixed(1)}%)`}
                  values={projection.map((r) => r.frete)}
                  format="currency"
                  negative
                />
                <DreRow
                  label={`Descontos (${baseData.descontoPerc.toFixed(1)}%)`}
                  values={projection.map((r) => r.desconto)}
                  format="currency"
                  negative
                />
                <DreRow
                  label={`Impostos (${impostosPerc}%)`}
                  values={projection.map((r) => r.impostos)}
                  format="currency"
                  negative
                />
                <DreRow
                  label={`Custo Produto (${custoProdPerc}%)`}
                  values={projection.map((r) => r.custoProduto)}
                  format="currency"
                  negative
                />
                <DreRow
                  label={`Outras Desp. (${outrasDespPerc}%)`}
                  values={projection.map((r) => r.outrasDesp)}
                  format="currency"
                  negative
                />
                <DreRow
                  label="Total Custos Variáveis"
                  values={projection.map((r) => r.totalCustosVar)}
                  format="currency"
                  negative
                  bold
                />

                {/* MARGEM DE CONTRIBUICAO */}
                <SectionHeader
                  label="MARGEM DE CONTRIBUIÇÃO"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="Margem (R$)"
                  values={projection.map((r) => r.margem)}
                  format="currency"
                  colored
                  bold
                />
                <DreRow
                  label="Margem (%)"
                  values={projection.map((r) => r.margemPerc)}
                  format="percent"
                  colored
                />

                {/* CUSTOS FIXOS */}
                <SectionHeader
                  label="CUSTOS FIXOS"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="Custos Fixos Totais"
                  values={projection.map((r) => r.custosFixos)}
                  format="currency"
                  negative
                />

                {/* RESULTADOS */}
                <SectionHeader
                  label="RESULTADOS"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="EBITDA (R$)"
                  values={projection.map((r) => r.ebitda)}
                  format="currency"
                  colored
                  bold
                />
                <DreRow
                  label="EBITDA (%)"
                  values={projection.map((r) => r.ebitdaPerc)}
                  format="percent"
                  colored
                  bold
                />

                {/* METRICAS DE MARKETING */}
                <SectionHeader
                  label="MÉTRICAS DE MARKETING"
                  colSpan={projection.length + 2}
                />
                <DreRow
                  label="Investimento"
                  values={projection.map((r) => r.invest)}
                  format="currency"
                  hideTotal
                />
                <DreRow
                  label="ROAS"
                  values={projection.map((r) => r.roas)}
                  format="roas"
                  hideTotal
                />
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Resumo Projetado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Receita Total
              </span>
              <span className="text-sm font-semibold">
                {formatCurrency(summary.totalReceita)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Investimento Total
              </span>
              <span className="text-sm font-semibold">
                {formatCurrency(summary.totalInvest)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <span className="text-sm text-muted-foreground">
                EBITDA Total
              </span>
              <span
                className={`text-sm font-bold ${summary.totalEbitda >= 0 ? "text-success" : "text-destructive"}`}
              >
                {formatCurrency(summary.totalEbitda)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Rentabilidade
              </span>
              <span className="text-sm font-semibold">
                {summary.mesesLucrativos}/{projection.length} meses lucrativos
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Financial Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {summary.avgEbitdaPerc > 15 ? (
                <CheckCircle className="h-4 w-4 text-success" />
              ) : (
                <AlertTriangle className={`h-4 w-4 ${healthColor}`} />
              )}
              Saúde Financeira
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className={`text-sm font-bold ${healthColor}`}>
                {healthLabel}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  summary.avgEbitdaPerc > 15
                    ? "bg-success"
                    : summary.avgEbitdaPerc > 5
                      ? "bg-warning"
                      : "bg-destructive"
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, summary.avgEbitdaPerc * 3))}%`,
                }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                EBITDA % médio
              </span>
              <span className={`text-sm font-bold ${healthColor}`}>
                {formatPercent(summary.avgEbitdaPerc)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                ROAS: início → fim
              </span>
              <span className="text-sm font-semibold">
                {summary.roasFirst.toFixed(2)}x → {summary.roasLast.toFixed(2)}x
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Recomendações Estratégicas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {summary.recs.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Sub-components ---

function InputField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  readonly = false,
  prefix,
  suffix,
  badge,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  readonly?: boolean;
  prefix?: string;
  suffix?: string;
  badge?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        {badge && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-success/10 text-success">
            {badge}
          </span>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          readOnly={readonly}
          className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors focus:border-primary focus:outline-none ${
            prefix ? "pl-9" : ""
          } ${suffix ? "pr-8" : ""} ${
            readonly
              ? "opacity-60 cursor-not-allowed"
              : "hover:border-primary/50"
          }`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  colSpan,
}: {
  label: string;
  colSpan: number;
}) {
  return (
    <tr className="border-t border-border">
      <td
        colSpan={colSpan}
        className="px-6 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30"
      >
        {label}
      </td>
    </tr>
  );
}

function DreRow({
  label,
  values,
  format,
  negative = false,
  colored = false,
  bold = false,
  hideTotal = false,
}: {
  label: string;
  values: number[];
  format: "currency" | "percent" | "number" | "roas";
  negative?: boolean;
  colored?: boolean;
  bold?: boolean;
  hideTotal?: boolean;
}) {
  const total = values.reduce((s, v) => s + v, 0);

  function fmt(v: number) {
    switch (format) {
      case "currency":
        return formatCurrency(Math.abs(v));
      case "percent":
        return formatPercent(v);
      case "number":
        return formatNumber(Math.round(v));
      case "roas":
        return `${v.toFixed(2)}x`;
    }
  }

  function cellColor(v: number) {
    if (colored) {
      return v >= 0 ? "text-success" : "text-destructive";
    }
    if (negative) {
      return "text-muted-foreground";
    }
    return "";
  }

  return (
    <tr className={`border-b border-border/50 ${bold ? "bg-muted/10" : ""}`}>
      <td
        className={`p-3 pl-6 text-sm ${bold ? "font-semibold" : "text-muted-foreground"}`}
      >
        {negative && !colored ? `(-) ${label}` : label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`p-3 text-right text-sm tabular-nums ${bold ? "font-semibold" : ""} ${cellColor(v)}`}
        >
          {negative && !colored && format === "currency" ? `-${fmt(v)}` : fmt(v)}
        </td>
      ))}
      <td
        className={`p-3 pr-6 text-right text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${hideTotal ? "text-muted-foreground/50" : cellColor(total)}`}
      >
        {hideTotal
          ? "—"
          : format === "percent" || format === "roas"
            ? fmt(values.length > 0 ? total / values.length : 0)
            : negative && !colored && format === "currency"
              ? `-${fmt(total)}`
              : fmt(total)}
      </td>
    </tr>
  );
}
