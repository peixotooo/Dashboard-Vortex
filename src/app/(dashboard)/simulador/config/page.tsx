"use client";

import React, { useEffect, useState } from "react";
import { SlidersHorizontal, Save, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigField } from "@/components/dashboard/config-field";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";

const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const DEFAULTS = {
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
};

export default function FinancialConfigPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDefault, setIsDefault] = useState(true);

  const [monthlyFixedCosts, setMonthlyFixedCosts] = useState(DEFAULTS.monthly_fixed_costs);
  const [taxPct, setTaxPct] = useState(DEFAULTS.tax_pct);
  const [productCostPct, setProductCostPct] = useState(DEFAULTS.product_cost_pct);
  const [otherExpensesPct, setOtherExpensesPct] = useState(DEFAULTS.other_expenses_pct);
  const [seasonality, setSeasonality] = useState<number[]>(DEFAULTS.monthly_seasonality);
  const [targetProfitMonthly, setTargetProfitMonthly] = useState(DEFAULTS.target_profit_monthly);
  const [safetyMarginPct, setSafetyMarginPct] = useState(DEFAULTS.safety_margin_pct);
  const [annualRevenueTarget, setAnnualRevenueTarget] = useState(DEFAULTS.annual_revenue_target);
  const [investPct, setInvestPct] = useState(DEFAULTS.invest_pct);
  const [fretePct, setFretePct] = useState(DEFAULTS.frete_pct);
  const [descontoPct, setDescontoPct] = useState(DEFAULTS.desconto_pct);

  useEffect(() => {
    if (!workspace?.id) return;

    async function fetchSettings() {
      setLoading(true);
      try {
        const res = await fetch("/api/financial-settings", {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        setMonthlyFixedCosts(data.monthly_fixed_costs ?? DEFAULTS.monthly_fixed_costs);
        setTaxPct(data.tax_pct ?? DEFAULTS.tax_pct);
        setProductCostPct(data.product_cost_pct ?? DEFAULTS.product_cost_pct);
        setOtherExpensesPct(data.other_expenses_pct ?? DEFAULTS.other_expenses_pct);
        setSeasonality(data.monthly_seasonality ?? DEFAULTS.monthly_seasonality);
        setTargetProfitMonthly(data.target_profit_monthly ?? DEFAULTS.target_profit_monthly);
        setSafetyMarginPct(data.safety_margin_pct ?? DEFAULTS.safety_margin_pct);
        setAnnualRevenueTarget(data.annual_revenue_target ?? DEFAULTS.annual_revenue_target);
        setInvestPct(data.invest_pct ?? DEFAULTS.invest_pct);
        setFretePct(data.frete_pct ?? DEFAULTS.frete_pct);
        setDescontoPct(data.desconto_pct ?? DEFAULTS.desconto_pct);
        setIsDefault(data.isDefault ?? true);
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [workspace?.id]);

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      const res = await fetch("/api/financial-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          monthly_fixed_costs: monthlyFixedCosts,
          tax_pct: taxPct,
          product_cost_pct: productCostPct,
          other_expenses_pct: otherExpensesPct,
          monthly_seasonality: seasonality,
          target_profit_monthly: targetProfitMonthly,
          safety_margin_pct: safetyMarginPct,
          annual_revenue_target: annualRevenueTarget,
          invest_pct: investPct,
          frete_pct: fretePct,
          desconto_pct: descontoPct,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setIsDefault(false);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      // Ignore
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setMonthlyFixedCosts(DEFAULTS.monthly_fixed_costs);
    setTaxPct(DEFAULTS.tax_pct);
    setProductCostPct(DEFAULTS.product_cost_pct);
    setOtherExpensesPct(DEFAULTS.other_expenses_pct);
    setSeasonality([...DEFAULTS.monthly_seasonality]);
    setTargetProfitMonthly(DEFAULTS.target_profit_monthly);
    setSafetyMarginPct(DEFAULTS.safety_margin_pct);
    setAnnualRevenueTarget(DEFAULTS.annual_revenue_target);
    setInvestPct(DEFAULTS.invest_pct);
    setFretePct(DEFAULTS.frete_pct);
    setDescontoPct(DEFAULTS.desconto_pct);
  }

  function updateSeasonality(index: number, value: number) {
    setSeasonality((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  const seasonalityTotal = seasonality.reduce((s, v) => s + v, 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
            Configurações Financeiras
          </h1>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
            Configurações Financeiras
          </h1>
          <p className="text-sm text-muted-foreground">
            Parâmetros usados no Simulador e no break-even do Overview
            {isDefault && (
              <span className="ml-2 text-xs text-warning">(usando padrões — salve para personalizar)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>

      {/* Meta e Premissas — destaque */}
      <Card className="border-primary/30 bg-primary/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Meta de Receita e Premissas de Execução</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-5">
            A meta mensal é distribuída automaticamente pela sazonalidade. As premissas abaixo são fixas no mês — desvios aparecem como alertas no Overview.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <ConfigField
              label="Receita Anual Desejada"
              value={annualRevenueTarget}
              onChange={setAnnualRevenueTarget}
              step={100000}
              prefix="R$"
              hint="Meta anual total de faturamento"
            />
            <ConfigField
              label="Ads % planejado"
              value={investPct}
              onChange={setInvestPct}
              step={0.5}
              suffix="%"
              hint="% da receita em investimento ads"
            />
            <ConfigField
              label="Frete % planejado"
              value={fretePct}
              onChange={setFretePct}
              step={0.5}
              suffix="%"
              hint="% da receita em frete"
            />
            <ConfigField
              label="Desconto % planejado"
              value={descontoPct}
              onChange={setDescontoPct}
              step={0.5}
              suffix="%"
              hint="% da receita em descontos"
            />
          </div>
          {/* Preview: meta do mês atual */}
          <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Meta este mês ({MONTH_LABELS[new Date().getMonth()]})</p>
              <p className="font-semibold text-primary">
                {formatCurrency(annualRevenueTarget * (seasonality[new Date().getMonth()] ?? 8.33) / 100)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custos var. totais (config)</p>
              <p className="font-semibold">
                {(investPct + fretePct + descontoPct + taxPct + productCostPct + otherExpensesPct).toFixed(1)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Custos e Margens */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custos e Margens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ConfigField
              label="Custo Fixo Mensal"
              value={monthlyFixedCosts}
              onChange={setMonthlyFixedCosts}
              step={1000}
              prefix="R$"
              hint={`Inclui folha, aluguel, ferramentas, etc.`}
            />
            <ConfigField
              label="Impostos"
              value={taxPct}
              onChange={setTaxPct}
              step={0.5}
              suffix="%"
              hint="% sobre receita bruta"
            />
            <ConfigField
              label="Custo do Produto"
              value={productCostPct}
              onChange={setProductCostPct}
              step={0.5}
              suffix="%"
              hint="CMV — % sobre receita"
            />
            <ConfigField
              label="Outras Despesas"
              value={otherExpensesPct}
              onChange={setOtherExpensesPct}
              step={0.5}
              suffix="%"
              hint="Gateway, comissões, etc."
            />
            <div className="border-t border-border pt-4 space-y-4">
              <ConfigField
                label="Lucro Requerido Mensal"
                value={targetProfitMonthly}
                onChange={setTargetProfitMonthly}
                step={1000}
                prefix="R$"
                hint="Usado no cálculo da meta (0 = apenas cobrir custos)"
              />
              <ConfigField
                label="Margem de Segurança"
                value={safetyMarginPct}
                onChange={setSafetyMarginPct}
                step={0.5}
                suffix="%"
                hint="Folga adicional sobre a meta"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sazonalidade */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Sazonalidade Mensal</span>
              <span className={`text-xs font-normal ${Math.abs(seasonalityTotal - 100) > 0.5 ? "text-destructive" : "text-muted-foreground"}`}>
                Total: {seasonalityTotal.toFixed(2)}%
                {Math.abs(seasonalityTotal - 100) > 0.5 && " (deveria somar ~100%)"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Peso de cada mês no faturamento anual. Baseado em dados históricos 2017-2025.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {MONTH_LABELS.map((month, i) => (
                <div key={month}>
                  <label className="text-xs text-muted-foreground mb-1 block">{month}</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={seasonality[i] ?? 0}
                      onChange={(e) => updateSeasonality(i, parseFloat(e.target.value) || 0)}
                      step={0.01}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm font-medium transition-colors hover:border-primary/50 focus:border-primary focus:outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            {/* Visual bar chart of seasonality */}
            <div className="mt-6 flex items-end gap-1 h-24">
              {seasonality.map((val, i) => {
                const maxVal = Math.max(...seasonality, 1);
                const heightPct = (val / maxVal) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary/60 transition-all"
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground">{MONTH_LABELS[i]}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Receita Anual</p>
              <p className="font-semibold">{formatCurrency(annualRevenueTarget)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custo Fixo/mês</p>
              <p className="font-semibold">{formatCurrency(monthlyFixedCosts)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custos Var. totais</p>
              <p className="font-semibold">{(investPct + fretePct + descontoPct + taxPct + productCostPct + otherExpensesPct).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Margem Contrib.</p>
              <p className="font-semibold">{(100 - investPct - fretePct - descontoPct - taxPct - productCostPct - otherExpensesPct).toFixed(1)}%</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            A meta mensal é calculada como: Receita Anual × Sazonalidade do mês. Valores reais de ads, frete e desconto são monitorados no Overview como desvios.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

