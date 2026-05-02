"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Target,
  History,
  LineChart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { simulateMacro } from "@/lib/commercial-simulator/calculate";
import type { Baseline, MacroSimulateOutput } from "@/lib/commercial-simulator/types";

type Settings = {
  piso_margem_pct: number;
  buffer_zona_verde_pct: number;
  custo_frete_medio_brl: number;
  ticket_minimo_frete_gratis_brl: number;
  product_cost_pct: number;
  tax_pct: number;
  other_expenses_pct: number;
  annual_revenue_target: number;
  monthly_seasonality: number[];
  isDefault: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  piso_margem_pct: 15,
  buffer_zona_verde_pct: 5,
  custo_frete_medio_brl: 25,
  ticket_minimo_frete_gratis_brl: 199,
  product_cost_pct: 25,
  tax_pct: 6,
  other_expenses_pct: 5,
  annual_revenue_target: 8000000,
  monthly_seasonality: [6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98],
  isDefault: true,
};

export default function MacroSimulatorPage() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [descontoPct, setDescontoPct] = useState(0);
  const [coberturaPct, setCoberturaPct] = useState(100);
  const [incrementoPct, setIncrementoPct] = useState(0);
  const [freteGratisCob, setFreteGratisCob] = useState(0);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [settingsRes, baselineRes] = await Promise.all([
          fetch("/api/simulador-comercial/settings", {
            headers: { "x-workspace-id": workspace!.id },
          }),
          fetch("/api/simulador-comercial/baseline", {
            headers: { "x-workspace-id": workspace!.id },
          }),
        ]);
        if (cancelled) return;
        const settingsData = await settingsRes.json();
        const baselineData = await baselineRes.json();
        if (!baselineRes.ok) {
          setError(baselineData.error ?? `Erro ${baselineRes.status}`);
        } else {
          setBaseline(baselineData);
        }
        setSettings(settingsData);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const result: MacroSimulateOutput | null = useMemo(() => {
    if (!baseline) return null;
    return simulateMacro({
      baseline,
      descontoPct,
      coberturaPct,
      incrementoVendasPct: incrementoPct,
      freteGratisCobertura: freteGratisCob,
      custoProdutoPct: settings.product_cost_pct,
      taxPct: settings.tax_pct,
      outrasDespesasPct: settings.other_expenses_pct,
      custoFreteMedioBrl: settings.custo_frete_medio_brl,
      pisoMargemPct: settings.piso_margem_pct,
      bufferZonaVerdePct: settings.buffer_zona_verde_pct,
    });
  }, [baseline, settings, descontoPct, coberturaPct, incrementoPct, freteGratisCob]);

  const metaMensal = useMemo(() => {
    const mes = new Date().getMonth();
    const peso = settings.monthly_seasonality[mes] ?? 8.33;
    return settings.annual_revenue_target * (peso / 100);
  }, [settings]);

  const coberturaPiso = settings.piso_margem_pct + settings.buffer_zona_verde_pct;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LineChart className="h-6 w-6 text-primary" />
            Simulador Macro
          </h1>
          <p className="text-sm text-muted-foreground">Carregando baseline dos últimos 30 dias...</p>
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || !baseline) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LineChart className="h-6 w-6 text-primary" />
            Simulador Macro
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <AlertTriangle className="h-10 w-10 text-warning" />
            <p className="font-medium">Não foi possível carregar o baseline</p>
            <p className="text-sm text-muted-foreground max-w-md">
              {error ?? "Sem vendas nos últimos 30 dias em crm_vendas. Confira a sincronização do CRM."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (baseline.numPedidos === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LineChart className="h-6 w-6 text-primary" />
            Simulador Macro
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <History className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Sem vendas nos últimos 30 dias</p>
            <p className="text-sm text-muted-foreground max-w-md">
              O simulador macro precisa de histórico em crm_vendas pra projetar cenário. Verifica a sync.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LineChart className="h-6 w-6 text-primary" />
          Simulador Macro
        </h1>
        <p className="text-sm text-muted-foreground">
          Projeta o impacto mensal de uma estratégia promocional sobre os últimos 30 dias de vendas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Baseline — últimos 30 dias
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Receita total" value={formatCurrency(baseline.totalReceita)} />
            <Stat label="Pedidos" value={baseline.numPedidos.toLocaleString("pt-BR")} />
            <Stat label="Ticket médio" value={formatCurrency(baseline.ticketMedio)} />
            <Stat
              label="Receita média/dia"
              value={formatCurrency(baseline.receitaMediaDiaria)}
              hint={`${baseline.diasComVenda} dias com venda`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estratégia promocional</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SliderRow
            label="Desconto médio aplicado"
            value={descontoPct}
            onChange={setDescontoPct}
            max={70}
            suffix="%"
            hint="Desconto adicional sobre o ticket médio histórico."
          />
          <SliderRow
            label="Cobertura — % das vendas com a oferta"
            value={coberturaPct}
            onChange={setCoberturaPct}
            max={100}
            suffix="%"
            hint="100% = oferta uniforme em todas vendas. 30% = só parte do volume pega a promo."
          />
          <SliderRow
            label="Frete grátis — % das vendas"
            value={freteGratisCob}
            onChange={setFreteGratisCob}
            max={100}
            suffix="%"
            hint={`Cada pedido coberto absorve ${formatCurrency(settings.custo_frete_medio_brl)} (config).`}
          />
          <SliderRow
            label="Lift estimado em vendas"
            value={incrementoPct}
            onChange={setIncrementoPct}
            min={-50}
            max={200}
            suffix="%"
            hint="Aumento esperado no volume de pedidos por causa da oferta. Comece com 0 (cenário pessimista) e ajuste com base em histórico de campanhas similares."
          />
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ScenarioCard
              icon={<History className="h-5 w-5" />}
              label="Histórico (mensalizado)"
              receita={result.historicoMensal.receita}
              margemBrl={result.historicoMensal.margemBrl}
              margemPct={result.historicoMensal.margemPct}
              numPedidos={result.historicoMensal.numPedidos}
              variant="neutral"
            />
            <ScenarioCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Projeção com oferta"
              receita={result.projetadoMensal.receita}
              margemBrl={result.projetadoMensal.margemBrl}
              margemPct={result.projetadoMensal.margemPct}
              numPedidos={result.projetadoMensal.numPedidos}
              variant={result.veredicto}
              highlight
            />
            <ScenarioCard
              icon={<Target className="h-5 w-5" />}
              label="Meta deste mês"
              receita={metaMensal}
              margemBrl={metaMensal * (result.historicoMensal.margemPct / 100)}
              margemPct={result.historicoMensal.margemPct}
              numPedidos={
                result.historicoMensal.ticketMedio > 0
                  ? metaMensal / result.historicoMensal.ticketMedio
                  : 0
              }
              variant="neutral"
              metaContext
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comparativo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <CompareRow
                  label="Receita projetada vs histórico"
                  value={formatCurrency(result.deltaReceita)}
                  positive={result.deltaReceita >= 0}
                />
                <CompareRow
                  label="Margem R$ projetada vs histórico"
                  value={formatCurrency(result.deltaMargemBrl)}
                  positive={result.deltaMargemBrl >= 0}
                />
                <CompareRow
                  label="Margem % projetada vs histórico"
                  value={`${result.deltaMargemPct >= 0 ? "+" : ""}${result.deltaMargemPct.toFixed(1)} pp`}
                  positive={result.deltaMargemPct >= 0}
                />
                <div className="border-t border-border pt-3">
                  <CompareRow
                    label="Receita projetada vs meta do mês"
                    value={`${(((result.projetadoMensal.receita / metaMensal) - 1) * 100).toFixed(1)}%`}
                    positive={result.projetadoMensal.receita >= metaMensal}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <VeredictoBanner
            veredicto={result.veredicto}
            explicacao={result.explicacao}
            limiteVerde={coberturaPiso}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-bold text-lg mt-1">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</p>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-mono">
          {value.toFixed(0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-primary"
      />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function ScenarioCard({
  icon,
  label,
  receita,
  margemBrl,
  margemPct,
  numPedidos,
  variant,
  highlight,
  metaContext,
}: {
  icon: React.ReactNode;
  label: string;
  receita: number;
  margemBrl: number;
  margemPct: number;
  numPedidos: number;
  variant: "verde" | "amarelo" | "vermelho" | "neutral";
  highlight?: boolean;
  metaContext?: boolean;
}) {
  const border = {
    verde: "border-emerald-300 dark:border-emerald-800",
    amarelo: "border-yellow-300 dark:border-yellow-800",
    vermelho: "border-red-300 dark:border-red-800",
    neutral: "border-border",
  }[variant];
  const bg = highlight
    ? {
        verde: "bg-emerald-50/50 dark:bg-emerald-950/20",
        amarelo: "bg-yellow-50/50 dark:bg-yellow-950/20",
        vermelho: "bg-red-50/50 dark:bg-red-950/20",
        neutral: "",
      }[variant]
    : "";

  return (
    <Card className={`border-2 ${border} ${bg}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita mensal</p>
          <p className="text-2xl font-bold">{formatCurrency(receita)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Margem R$</p>
            <p className="font-semibold">{formatCurrency(margemBrl)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Margem %</p>
            <p className="font-semibold">{margemPct.toFixed(1)}%</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedidos</p>
            <p className="font-semibold">
              {Math.round(numPedidos).toLocaleString("pt-BR")}
              {metaContext && (
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  (no ticket atual)
                </span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompareRow({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold font-mono ${positive ? "text-emerald-600" : "text-red-600"}`}>
        {value}
      </span>
    </div>
  );
}

function VeredictoBanner({
  veredicto,
  explicacao,
  limiteVerde,
}: {
  veredicto: "verde" | "amarelo" | "vermelho";
  explicacao: string;
  limiteVerde: number;
}) {
  const cfg = {
    verde: {
      bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800",
      text: "text-emerald-900 dark:text-emerald-100",
      icon: <CheckCircle2 className="h-6 w-6 text-emerald-600" />,
      label: `Verde — margem ≥ ${limiteVerde.toFixed(1)}%`,
    },
    amarelo: {
      bg: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800",
      text: "text-yellow-900 dark:text-yellow-100",
      icon: <AlertTriangle className="h-6 w-6 text-yellow-600" />,
      label: "Amarela — operar com gatilho",
    },
    vermelho: {
      bg: "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800",
      text: "text-red-900 dark:text-red-100",
      icon: <XCircle className="h-6 w-6 text-red-600" />,
      label: "Vermelha — cenário derruba a margem abaixo do piso",
    },
  }[veredicto];

  return (
    <Card className={`border-2 ${cfg.bg}`}>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          {cfg.icon}
          <div>
            <p className={`font-semibold ${cfg.text}`}>{cfg.label}</p>
            <p className={`text-sm mt-1 ${cfg.text}`}>{explicacao}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
