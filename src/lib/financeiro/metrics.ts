// src/lib/financeiro/metrics.ts
//
// Métricas-norte HONESTAS do módulo financeiro/simulador.
//
// Esta lib existe para acabar com as "pontes podres" da auditoria:
//
//   1. ROAS de plataforma (receita auto-reportada da Meta) double-conta
//      a mesma venda com Google/GA4. Aqui SÓ existe MER blended =
//      receita REAL (loja) / spend TOTAL. Não há função que aceite
//      receita de plataforma como retorno.
//
//   2. "Caixa = receita - ads" ignorava ~36% de custos variáveis. Aqui
//      caixa/contribuição sempre desconta COGS, impostos, frete,
//      desconto e mídia em camadas (CM1/CM2/CM3).
//
//   3. Número mágico "-8" no healthyRoas vira safety_margin_pct
//      configurável.
//
// Todas as funções são puras e retornam `null` quando o dado não
// permite o cálculo (em vez de 0, Infinity ou NaN, que mentem).

// ---------------------------------------------------------------------------
// Eficiência de mídia: MER e aMER (substituem ROAS de plataforma)
// ---------------------------------------------------------------------------

/**
 * MER blended (Marketing Efficiency Ratio) = receita REAL total / spend
 * TOTAL. É a única leitura honesta de retorno de mídia: usa a receita do
 * extrato (VNDA/loja), não a receita atribuída que cada plataforma
 * auto-reporta (e que Meta + Google contam em dobro).
 *
 * @param realRevenue receita real do período (loja própria; idealmente
 *   consolidada com ML quando houver ingestão).
 * @param totalSpend  soma do spend de TODAS as plataformas.
 */
export function merBlended(realRevenue: number, totalSpend: number): number | null {
  if (!(totalSpend > 0)) return null;
  return realRevenue / totalSpend;
}

/**
 * aMER (MER marginal) = Δreceita / Δspend entre dois períodos. Responde
 * "o que o PRÓXIMO real de mídia rende", que é o que decide escala —
 * não o MER médio. Escala-se enquanto aMER > breakeven-MER.
 */
export function aMer(
  prevRevenue: number,
  prevSpend: number,
  currRevenue: number,
  currSpend: number
): number | null {
  const dS = currSpend - prevSpend;
  if (Math.abs(dS) < 1e-9) return null;
  return (currRevenue - prevRevenue) / dS;
}

// ---------------------------------------------------------------------------
// Margem de contribuição em camadas (CM1 / CM2 / CM3)
// ---------------------------------------------------------------------------

export interface ContributionInput {
  /** Receita líquida do período (já net de desconto se vier do crm_vendas). */
  revenue: number;
  /** Custo do produto vendido (CMV) em BRL. */
  cogs: number;
  /** Frete absorvido em BRL. */
  freight: number;
  /** Desconto concedido em BRL (informe 0 se a receita já é líquida). */
  discount: number;
  /** Impostos em BRL. */
  taxes: number;
  /** Taxa de gateway/parcelamento/chargeback em BRL. */
  paymentFee: number;
  /** Investimento em mídia (custo de aquisição) em BRL. */
  ads: number;
  /** Outras despesas operacionais variáveis (fulfillment, SAC…) em BRL. */
  opex: number;
}

export interface ContributionResult {
  /** CM1 = receita - COGS - frete - desconto - impostos - taxa pagamento.
   *  Margem por PEDIDO, antes de qualquer custo de aquisição. */
  cm1: number;
  /** CM2 = CM1 - mídia. É o número que governa escala: lucro real antes
   *  dos custos fixos. */
  cm2: number;
  /** CM3 = CM2 - outras despesas operacionais. */
  cm3: number;
  cm1Pct: number;
  cm2Pct: number;
  cm3Pct: number;
}

/**
 * Decompõe a margem em camadas para que cada problema tenha dono: CM1
 * fraco = produto/comercial/pagamento; CM2 fraco = aquisição cara; CM3
 * fraco = operação. Colapsar tudo num número só esconde a alavanca.
 */
export function contributionMargins(input: ContributionInput): ContributionResult {
  const { revenue, cogs, freight, discount, taxes, paymentFee, ads, opex } = input;
  const cm1 = revenue - cogs - freight - discount - taxes - paymentFee;
  const cm2 = cm1 - ads;
  const cm3 = cm2 - opex;
  const pct = (v: number) => (revenue > 0 ? v / revenue : 0);
  return {
    cm1,
    cm2,
    cm3,
    cm1Pct: pct(cm1),
    cm2Pct: pct(cm2),
    cm3Pct: pct(cm3),
  };
}

// ---------------------------------------------------------------------------
// MER de breakeven e saudável (sem número mágico)
// ---------------------------------------------------------------------------

/**
 * Espaço de ads (em pontos percentuais da receita) que sobra para mídia
 * mantendo o breakeven, dada a margem de contribuição pré-ads e os
 * custos fixos diluídos na receita mensal.
 *
 *   availableForAds% = CMpreAds% - (custosFixos / receitaMensal × 100)
 */
export function availableForAdsPct(
  cmPreAdsPct: number,
  monthlyFixedCosts: number,
  monthlyRevenue: number
): number {
  const fixedPct = monthlyRevenue > 0 ? (monthlyFixedCosts / monthlyRevenue) * 100 : 0;
  return cmPreAdsPct - fixedPct;
}

/**
 * MER de breakeven: a partir de quanto de retorno por real de ads a
 * operação para de dar prejuízo. MER abaixo disso = queima caixa.
 *
 *   breakevenMER = 100 / availableForAds%
 *
 * (Mesma álgebra do antigo breakevenRoas, mas alimentado por receita
 * REAL e por todas as camadas de custo — não pela receita de plataforma.)
 */
export function breakevenMer(
  cmPreAdsPct: number,
  monthlyFixedCosts: number,
  monthlyRevenue: number
): number | null {
  const a = availableForAdsPct(cmPreAdsPct, monthlyFixedCosts, monthlyRevenue);
  return a > 0 ? 100 / a : null;
}

/**
 * MER saudável: breakeven + uma margem de segurança configurável. AQUI
 * morre o número mágico "-8" — agora é safety_margin_pct, que o
 * workspace define e enxerga.
 *
 *   healthyMER = 100 / (availableForAds% - safety_margin_pct)
 */
export function healthyMer(
  cmPreAdsPct: number,
  monthlyFixedCosts: number,
  monthlyRevenue: number,
  safetyMarginPct: number
): number | null {
  const a =
    availableForAdsPct(cmPreAdsPct, monthlyFixedCosts, monthlyRevenue) - safetyMarginPct;
  return a > 0 ? 100 / a : null;
}

// ---------------------------------------------------------------------------
// Aquisição: nCAC e payback (separar cliente novo de recompra)
// ---------------------------------------------------------------------------

/**
 * nCAC = custo de aquisição de cliente NOVO = spend total / clientes
 * novos do período. Diferente do CAC blended (que divide pelo total de
 * clientes, inflando o retorno aparente porque recompra não custou mídia
 * naquele mês).
 */
export function nCac(totalSpend: number, newCustomers: number): number | null {
  if (!(newCustomers > 0)) return null;
  return totalSpend / newCustomers;
}

/**
 * CAC payback em PEDIDOS: quantos pedidos até a contribuição acumulada do
 * cliente cobrir o nCAC. Em moda costuma ser 1–3. Diz se aceitar CM
 * negativo no 1º pedido é investimento saudável (recupera na recompra) ou
 * prejuízo de verdade.
 *
 * @param contributionPerOrder CM1 médio por pedido (margem de contribuição).
 */
export function cacPaybackOrders(
  ncac: number | null,
  contributionPerOrder: number
): number | null {
  if (ncac == null || !(contributionPerOrder > 0)) return null;
  return ncac / contributionPerOrder;
}

/** Taxa de recompra = pedidos recorrentes / total de pedidos. */
export function repeatRate(repeatOrders: number, totalOrders: number): number | null {
  if (!(totalOrders > 0)) return null;
  return repeatOrders / totalOrders;
}

// ---------------------------------------------------------------------------
// Estoque: cobertura em dias (o maior dreno de caixa em moda)
// ---------------------------------------------------------------------------

/**
 * Cobertura de estoque em DIAS = unidades em mãos / venda diária. Antes
 * de mandar "escala liberada" num campeão, é isto que diz se ele aguenta
 * a demanda ou se vamos pagar ads para empurrar tráfego pra ruptura.
 *
 * Retorna `null` quando não há run-rate (não dá pra estimar) e `Infinity`
 * quando há estoque mas zero venda no período.
 */
export function inventoryCoverageDays(
  stockUnits: number,
  dailyRunRate: number
): number | null {
  if (dailyRunRate < 0 || stockUnits < 0) return null;
  if (dailyRunRate === 0) return stockUnits > 0 ? Infinity : null;
  return stockUnits / dailyRunRate;
}

// ---------------------------------------------------------------------------
// Confiabilidade do dado de margem (coverage_pct)
// ---------------------------------------------------------------------------

export type Reliability = "alta" | "media" | "baixa";

/**
 * Classifica o quanto a margem/lucro é FATO (custo real cadastrado em
 * product_costs) vs PREMISSA (CMV default circular). coverage_pct vem do
 * snapshot ABC. Abaixo de ~70% nenhuma decisão de capital deveria se
 * ancorar na margem projetada.
 *
 * @param coveragePct fração 0..1 da receita com custo real cadastrado.
 */
export function coverageReliability(coveragePct: number): Reliability {
  if (coveragePct >= 0.7) return "alta";
  if (coveragePct >= 0.4) return "media";
  return "baixa";
}

/** Texto curto pronto para badge ("Confiável" / "Parcial" / "Estimativa"). */
export function coverageLabel(coveragePct: number): string {
  const r = coverageReliability(coveragePct);
  return r === "alta" ? "Confiável" : r === "media" ? "Parcial" : "Estimativa";
}

// ---------------------------------------------------------------------------
// Formatação compartilhada (para os cards e tooltips ficarem consistentes)
// ---------------------------------------------------------------------------

export function fmtMer(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}x`;
}

export function fmtPct(frac: number | null, digits = 1): string {
  return frac == null ? "—" : `${(frac * 100).toFixed(digits)}%`;
}

export function fmtDays(v: number | null): string {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return `${Math.round(v)}d`;
}
