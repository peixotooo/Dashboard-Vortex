// Engine de pricing dinâmico (Conceito 5 do SDD).
//
// Regras puras — recebe um snapshot (idade, cobertura, margem, preço, desconto)
// e os parâmetros de config, devolve a ação recomendada. Sem side effects:
// quem persiste é o orchestrator.
//
// Modos = multiplicadores no incremento de desconto:
//   agressivo  = 1.5×  (incrementos maiores, ideal pra Black Friday / queima)
//   regular    = 1.0×  (dia a dia)
//   conservador= 0.6×  (cenário de baixa oferta)
//
// Trava de margem: depois de calcular o novo preço, valida que a margem
// resultante ≥ trava_margem_minima_pct. Se quebrar, recalcula o desconto
// máximo permitido (que ainda respeita a trava). Se mesmo zero-desconto
// quebra (CMV está muito alto), retorna action='hold' com motivo claro.

import type { CompositionInput } from "./types";
import { ENGINE_MODE_MULTIPLIERS, type EngineMode, type EngineSettings } from "./types";
import { computeMargin } from "./composition";

export type EngineSnapshot = {
  sku: string;
  preco_de: number;
  preco_por: number;
  desconto_pct_atual: number; // fração 0..1
  idade_dias: number;
  cobertura_dias: number | null;
  stock_units: number;
  vendas_dia_unidades: number;
  margem_pct_atual: number | null; // fração 0..1
  em_campanha: boolean;
  composition: CompositionInput;
};

export type EngineDecision = {
  sku: string;
  action: "markdown" | "markup" | "hold";
  reason: string;
  preco_de: number;
  preco_por_atual: number;
  preco_por_novo: number;
  desconto_pct_atual: number;
  desconto_pct_novo: number;
  margem_pct_atual: number | null;
  margem_pct_nova: number | null;
  margem_brl_nova: number | null;
  trava_acionada: boolean;
  rule: {
    modo: EngineMode;
    pilar: "dinamico" | "campanha";
    idade_dias: number;
    cobertura_dias: number | null;
    incremento_aplicado_pct?: number;
    reducao_aplicada_pct?: number;
    trava_margem_minima_pct: number;
  };
};

function shouldMarkdown(s: EngineSnapshot, cfg: EngineSettings): boolean {
  if (s.cobertura_dias == null) return false;
  return (
    s.idade_dias >= cfg.markdown_idade_min &&
    s.cobertura_dias >= cfg.markdown_cobertura_min &&
    s.idade_dias + s.cobertura_dias >= cfg.markdown_soma_min
  );
}

// Step up (regra do user, espelhada no SDD do G4): se um produto descontado
// está girando bem (cobertura curta), devolver parte do desconto pra testar
// se a demanda continua. NÃO depende de idade nem de margem — qualquer SKU
// em sale com cobertura curta é candidato. Engine só dispara markup se já
// existe desconto a reduzir.
function shouldMarkup(s: EngineSnapshot, cfg: EngineSettings): boolean {
  if (s.cobertura_dias == null) return false;
  if (s.desconto_pct_atual <= 0) return false;
  return s.cobertura_dias <= cfg.markup_cobertura_max;
}

// Maior desconto que ainda respeita trava_margem_minima_pct, dado o preco_de
// e a composição. Resolve algebricamente: trava ≤ margem_pct = 1 - (cvar/preco)
// - impostos - taxas → desconto_max = 1 - cvar / (preco_de * (1 - impostos - taxas - trava))
function maxDescontoPermitido(s: EngineSnapshot, cfg: EngineSettings): number {
  const cvar =
    s.composition.cogs +
    s.composition.frete_unitario +
    s.composition.marketing_unitario +
    s.composition.rateio_fixo;
  const fator =
    1 -
    s.composition.impostos_pct -
    s.composition.taxas_comissoes_pct -
    cfg.trava_margem_minima_pct;
  if (fator <= 0 || s.preco_de <= 0) return 0;
  const preco_min_trava = cvar / fator;
  if (preco_min_trava >= s.preco_de) return 0;
  return 1 - preco_min_trava / s.preco_de;
}

export function evaluateSku(s: EngineSnapshot, cfg: EngineSettings): EngineDecision {
  const baseDecision: EngineDecision = {
    sku: s.sku,
    action: "hold",
    reason: "sem regra aplicável",
    preco_de: s.preco_de,
    preco_por_atual: s.preco_por,
    preco_por_novo: s.preco_por,
    desconto_pct_atual: s.desconto_pct_atual,
    desconto_pct_novo: s.desconto_pct_atual,
    margem_pct_atual: s.margem_pct_atual,
    margem_pct_nova: s.margem_pct_atual,
    margem_brl_nova: null,
    trava_acionada: false,
    rule: {
      modo: cfg.modo,
      pilar: "dinamico",
      idade_dias: s.idade_dias,
      cobertura_dias: s.cobertura_dias,
      trava_margem_minima_pct: cfg.trava_margem_minima_pct,
    },
  };

  // Pilar campanha sobrepõe — engine não toca em SKUs com cupom ativo
  if (s.em_campanha) {
    return {
      ...baseDecision,
      reason: "campanha ativa",
      rule: { ...baseDecision.rule, pilar: "campanha" },
    };
  }

  const mult = ENGINE_MODE_MULTIPLIERS[cfg.modo];

  // Mark Up tem prioridade sobre Mark Down (item novo + estoque baixo + margem
  // baixa → reduzir desconto antes de cair em regra de Mark Down por idade).
  if (shouldMarkup(s, cfg)) {
    const reducao = cfg.markup_reducao_pct * mult;
    const novoDesconto = Math.max(0, s.desconto_pct_atual - reducao);
    const novoPreco = s.preco_de * (1 - novoDesconto);
    const margem = computeMargin(s.composition, novoPreco);
    return {
      ...baseDecision,
      action: "markup",
      reason: `step up -${(reducao * 100).toFixed(1)}pp de desconto (cobertura ${s.cobertura_dias}d sugere demanda forte, testar preço maior)`,
      desconto_pct_novo: novoDesconto,
      preco_por_novo: novoPreco,
      margem_pct_nova: margem.margem_pct,
      margem_brl_nova: margem.margem_brl,
      rule: { ...baseDecision.rule, reducao_aplicada_pct: reducao },
    };
  }

  if (shouldMarkdown(s, cfg)) {
    const incremento =
      s.desconto_pct_atual === 0
        ? cfg.markdown_desconto_inicial_pct * mult
        : cfg.markdown_incremento_pct * mult;
    let novoDesconto = s.desconto_pct_atual + incremento;
    let travaAcionada = false;

    const maxPermitido = maxDescontoPermitido(s, cfg);
    if (novoDesconto > maxPermitido) {
      travaAcionada = true;
      novoDesconto = Math.max(s.desconto_pct_atual, maxPermitido);
    }

    if (novoDesconto <= s.desconto_pct_atual) {
      return {
        ...baseDecision,
        reason: "markdown bloqueado pela trava de margem",
        trava_acionada: true,
        rule: { ...baseDecision.rule, incremento_aplicado_pct: 0 },
      };
    }

    const novoPreco = s.preco_de * (1 - novoDesconto);
    const margem = computeMargin(s.composition, novoPreco);
    return {
      ...baseDecision,
      action: "markdown",
      reason: travaAcionada
        ? `markdown limitado pela trava (idade ${s.idade_dias}, cobertura ${s.cobertura_dias})`
        : `markdown +${(incremento * 100).toFixed(1)}pp (idade ${s.idade_dias}, cobertura ${s.cobertura_dias})`,
      desconto_pct_novo: novoDesconto,
      preco_por_novo: novoPreco,
      margem_pct_nova: margem.margem_pct,
      margem_brl_nova: margem.margem_brl,
      trava_acionada: travaAcionada,
      rule: {
        ...baseDecision.rule,
        incremento_aplicado_pct: novoDesconto - s.desconto_pct_atual,
      },
    };
  }

  return baseDecision;
}
