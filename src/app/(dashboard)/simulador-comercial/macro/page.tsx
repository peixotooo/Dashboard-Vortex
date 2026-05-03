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
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

  const ticketMedio = baseline.ticketMedio;
  const cmvPctTexto = settings.product_cost_pct.toFixed(1);
  const taxPctTexto = settings.tax_pct.toFixed(1);
  const outrasPctTexto = settings.other_expenses_pct.toFixed(1);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LineChart className="h-6 w-6 text-primary" />
          Simulador Macro
        </h1>
        <p className="text-sm text-muted-foreground">
          Projeta o impacto mensal de uma estratégia promocional sobre os últimos 30 dias de vendas. Passe o mouse nos ícones <Info className="inline h-3 w-3 align-text-bottom" /> pra ver o que cada número significa.
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
            <Stat
              label="Receita total"
              value={formatCurrency(baseline.totalReceita)}
              info={{
                what: "Soma de tudo que vendeu nos últimos 30 dias (de hoje pra trás).",
                impacts: "Vem direto de crm_vendas.valor. Não desconta frete cobrado, impostos ou cancelamentos posteriores.",
                formula: "Σ valor de todos os pedidos com data_compra nos últimos 30d",
              }}
            />
            <Stat
              label="Pedidos"
              value={baseline.numPedidos.toLocaleString("pt-BR")}
              info={{
                what: "Quantidade de pedidos no período de 30 dias.",
                impacts: "Reflete o volume real de transações. Usado pra calcular ticket médio e mensalizar a projeção.",
                formula: "COUNT(pedidos com valor > 0)",
              }}
            />
            <Stat
              label="Ticket médio"
              value={formatCurrency(baseline.ticketMedio)}
              info={{
                what: "Valor médio de cada pedido no período.",
                impacts: "Já inclui descontos que você deu na época. O slider 'desconto médio' aplica como ADICIONAL sobre esse valor.",
                formula: "Receita total ÷ Número de pedidos",
              }}
            />
            <Stat
              label="Receita média/dia"
              value={formatCurrency(baseline.receitaMediaDiaria)}
              hint={`${baseline.diasComVenda} dias com venda`}
              info={{
                what: "Receita média por dia útil de venda no período.",
                impacts: "Considera só dias que tiveram pelo menos uma venda (ignora dias zerados). Usada pra mensalizar projeção.",
                formula: "Receita total ÷ Dias com venda",
              }}
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
            info={{
              what: "% de desconto que você quer simular sobre o ticket médio atual.",
              impacts: "Reduz a receita por pedido. Não mexe no CMV (continua o mesmo) — então derruba margem em R$ e em %.",
              formula: "ticket_promo = ticket_medio × (1 − desconto%)",
            }}
          />
          <SliderRow
            label="Cobertura — % das vendas com a oferta"
            value={coberturaPct}
            onChange={setCoberturaPct}
            max={100}
            suffix="%"
            hint="100% = oferta uniforme em todas vendas. 30% = só parte do volume pega a promo."
            info={{
              what: "Que fatia do volume mensal recebe esse desconto.",
              impacts: "100% = todo mundo pega o desconto (cenário uniforme). Reduzir simula casos onde só parte das vendas usa o cupom (ex: cupom de email só converte 20% da base).",
              formula: "pedidos_promo = pedidos_total × cobertura%; pedidos_cheios = pedidos_total × (1 − cobertura%)",
            }}
          />
          <SliderRow
            label="Frete grátis — % das vendas"
            value={freteGratisCob}
            onChange={setFreteGratisCob}
            max={100}
            suffix="%"
            hint={`Cada pedido coberto absorve ${formatCurrency(settings.custo_frete_medio_brl)} (config).`}
            info={{
              what: "Que fatia do volume tem o frete absorvido pela loja.",
              impacts: `Para cada pedido coberto, soma ${formatCurrency(settings.custo_frete_medio_brl)} no custo total mensal. Custo configurado em /simulador-comercial/config.`,
              formula: `frete_absorvido_total = pedidos_total × frete_gratis% × ${formatCurrency(settings.custo_frete_medio_brl)}`,
            }}
          />
          <SliderRow
            label="Lift estimado em vendas"
            value={incrementoPct}
            onChange={setIncrementoPct}
            min={-50}
            max={200}
            suffix="%"
            hint="Aumento esperado no volume de pedidos por causa da oferta. Comece com 0 (cenário pessimista) e ajuste com base em histórico de campanhas similares."
            info={{
              what: "Aumento esperado de volume gerado pela oferta. É um chute seu — não tem ML aqui.",
              impacts: "Multiplica o número de pedidos do cenário projetado. 0% = pessimista (só perde margem). 50% = oferta gera 50% mais pedidos. Negativo simula canibalização.",
              formula: "pedidos_projetados = pedidos_baseline × (1 + lift%)",
            }}
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
              cmvPctTexto={cmvPctTexto}
              taxPctTexto={taxPctTexto}
              outrasPctTexto={outrasPctTexto}
              ticketMedio={ticketMedio}
              cardKind="historico"
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
              cmvPctTexto={cmvPctTexto}
              taxPctTexto={taxPctTexto}
              outrasPctTexto={outrasPctTexto}
              ticketMedio={result.projetadoMensal.ticketMedio}
              cardKind="projecao"
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
              cmvPctTexto={cmvPctTexto}
              taxPctTexto={taxPctTexto}
              outrasPctTexto={outrasPctTexto}
              ticketMedio={ticketMedio}
              cardKind="meta"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            Como esse simulador calcula
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">"Margem R$" = margem de contribuição mensal</strong> — receita menos custos variáveis (CMV, impostos, outras despesas) e frete absorvido. <strong className="text-foreground">Não inclui custo fixo</strong> (folha, aluguel, ferramentas).
          </p>
          <p>
            Pra saber se cobre o break-even mensal, compare a margem R$ contra o custo fixo configurado em <em>Configurações Financeiras</em>. O lucro operacional aparece no <em>Overview</em>.
          </p>
          <div className="bg-muted/40 rounded-lg p-3 font-mono text-xs space-y-1.5">
            <p>receita = pedidos_promo × ticket_promo + pedidos_cheios × ticket_medio</p>
            <p>custo_total = receita × {cmvPctTexto}% (CMV) + receita × {taxPctTexto}% (impostos) + receita × {outrasPctTexto}% (outras) + frete_absorvido</p>
            <p>margem_brl = receita − custo_total</p>
            <p>margem_pct = margem_brl ÷ receita × 100</p>
          </div>
          <p className="text-xs">
            CMV usa o ticket bruto como base (não o ticket pós-desconto), então o desconto direto reduz margem em proporção maior que a receita — comportamento alinhado com o simulador por produto.
          </p>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

type InfoCopy = {
  what: string;
  impacts: string;
  formula: string;
};

function MetricInfo({ info }: { info: InfoCopy }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Ver explicação"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-xs bg-popover text-popover-foreground border border-border shadow-lg p-3 space-y-2"
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">O que é</p>
          <p className="text-xs">{info.what}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">O que impacta</p>
          <p className="text-xs">{info.impacts}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Fórmula</p>
          <p className="text-xs font-mono bg-muted/60 rounded px-1.5 py-1">{info.formula}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function Stat({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  info?: InfoCopy;
}) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {info && <MetricInfo info={info} />}
      </div>
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
  info,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max: number;
  suffix?: string;
  hint?: string;
  info?: InfoCopy;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium">{label}</label>
          {info && <MetricInfo info={info} />}
        </div>
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
  cmvPctTexto,
  taxPctTexto,
  outrasPctTexto,
  ticketMedio,
  cardKind,
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
  cmvPctTexto: string;
  taxPctTexto: string;
  outrasPctTexto: string;
  ticketMedio: number;
  cardKind: "historico" | "projecao" | "meta";
}) {
  const receitaInfo: InfoCopy = {
    what:
      cardKind === "historico"
        ? "Receita do baseline (30d) extrapolada pra um mês inteiro."
        : cardKind === "projecao"
          ? "Receita projetada se você aplicar a estratégia desenhada nos sliders acima."
          : "Meta de receita pro mês corrente, vinda das Configurações Financeiras.",
    impacts:
      cardKind === "historico"
        ? "Reflete o ritmo atual. Se a sync de crm_vendas estiver atrasada, esse número fica defasado."
        : cardKind === "projecao"
          ? "Sobe ou desce conforme cobertura, desconto e lift. Cobertura alta + lift baixo derruba a receita."
          : "Vem de annual_revenue_target × sazonalidade do mês. Editável em /simulador/config.",
    formula:
      cardKind === "historico"
        ? "(receita_total_30d ÷ dias_com_venda) × 30  →  ou pedidos_30d × ticket_medio"
        : cardKind === "projecao"
          ? "pedidos_promo × ticket_promo + pedidos_cheios × ticket_medio"
          : "annual_revenue_target × seasonality[mes_atual] ÷ 100",
  };

  const margemBrlInfo: InfoCopy = {
    what:
      "Margem de contribuição em R$ — o que sobra da receita depois de tirar custos variáveis (CMV, impostos, outras despesas) e frete absorvido. NÃO desconta custo fixo (folha, aluguel, ferramentas).",
    impacts:
      cardKind === "projecao"
        ? "Cai com desconto direto e frete grátis. Sobe com lift positivo. Pra saber se cobre o break-even, compare contra o custo fixo no Overview."
        : "Compare contra o custo fixo mensal pra ver lucro operacional. Se margem > custo fixo → lucro. Se < → prejuízo no mês.",
    formula: `receita − (CMV ${cmvPctTexto}% + impostos ${taxPctTexto}% + outras ${outrasPctTexto}%) − frete_absorvido`,
  };

  const margemPctInfo: InfoCopy = {
    what:
      "Margem de contribuição percentual — quantos % da receita viram margem antes do custo fixo.",
    impacts:
      "Indicador de saúde da operação. O simulador classifica como verde/amarelo/vermelho usando o piso configurado em /simulador-comercial/config.",
    formula: "margem_brl ÷ receita × 100",
  };

  const pedidosInfo: InfoCopy = metaContext
    ? {
        what: "Quantos pedidos seriam necessários pra bater a meta no ticket médio atual.",
        impacts: "Se está muito acima do número de pedidos histórico, indica que a meta exige crescimento de volume — não basta manter o ritmo.",
        formula: "meta_receita ÷ ticket_medio_historico",
      }
    : {
        what:
          cardKind === "historico"
            ? "Pedidos do baseline mensalizados (proporcional aos dias com venda)."
            : "Pedidos projetados após aplicar o lift. Distribuídos entre cobertura promo e venda cheia.",
        impacts:
          cardKind === "historico"
            ? "Reflete a frequência atual de compras."
            : "Lift maior aumenta esse número. Cobertura define quantos pegam o desconto, mas o total de pedidos vem do lift.",
        formula:
          cardKind === "historico"
            ? "(pedidos_30d ÷ dias_com_venda) × 30"
            : "pedidos_baseline_mensalizado × (1 + lift%)",
      };

  const ticketInfo: InfoCopy = {
    what: "Valor médio por pedido neste cenário.",
    impacts:
      cardKind === "projecao"
        ? "Cai conforme aumenta cobertura e desconto. Se cobertura = 100%, ticket = ticket_medio × (1 − desconto%)."
        : "Base de cálculo pra mensalizar receita e projetar volume.",
    formula:
      cardKind === "projecao"
        ? "(pedidos_promo × ticket_promo + pedidos_cheios × ticket_medio) ÷ pedidos_total"
        : "receita_total ÷ pedidos_total",
  };
  const ticketValor = formatCurrency(ticketMedio);

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
          <div className="flex items-center gap-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita mensal</p>
            <MetricInfo info={receitaInfo} />
          </div>
          <p className="text-2xl font-bold">{formatCurrency(receita)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contribuição R$</p>
              <MetricInfo info={margemBrlInfo} />
            </div>
            <p className="font-semibold">{formatCurrency(margemBrl)}</p>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Margem %</p>
              <MetricInfo info={margemPctInfo} />
            </div>
            <p className="font-semibold">{margemPct.toFixed(1)}%</p>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedidos</p>
              <MetricInfo info={pedidosInfo} />
            </div>
            <p className="font-semibold">
              {Math.round(numPedidos).toLocaleString("pt-BR")}
              {metaContext && (
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  (no ticket atual)
                </span>
              )}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ticket médio</p>
              <MetricInfo info={ticketInfo} />
            </div>
            <p className="font-semibold">{ticketValor}</p>
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
