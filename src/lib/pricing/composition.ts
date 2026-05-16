// Composição de preço por SKU (Conceito 1 do SDD).
//
// Fórmulas:
//   custos_variaveis = cogs + frete_unitario + marketing_unitario + rateio_fixo
//   preco_minimo = custos_variaveis / (1 - impostos_pct - taxas_comissoes_pct)
//   preco_alvo   = custos_variaveis / (1 - impostos_pct - taxas_comissoes_pct - margem_alvo_pct)
//
// Percentuais entram como fração (0.06 = 6%). Se a soma de impostos +
// taxas + margem >= 1, retorna Infinity (preço impraticável — gestor precisa
// rever inputs).

import type { CompositionInput, CompositionOutput } from "./types";

export function computeComposition(
  input: CompositionInput,
  precoPraticado: number | null = null
): CompositionOutput {
  const custos_variaveis =
    input.cogs +
    input.frete_unitario +
    input.marketing_unitario +
    input.rateio_fixo;

  const fatorMinimo = 1 - input.impostos_pct - input.taxas_comissoes_pct;
  const fatorAlvo = fatorMinimo - input.margem_alvo_pct;

  const preco_minimo = fatorMinimo > 0 ? custos_variaveis / fatorMinimo : Infinity;
  const preco_alvo = fatorAlvo > 0 ? custos_variaveis / fatorAlvo : Infinity;

  let margem_atual_brl: number | null = null;
  let margem_atual_pct: number | null = null;
  let status: CompositionOutput["status"] = "ok";

  if (precoPraticado != null && precoPraticado > 0) {
    const impostos_brl = precoPraticado * input.impostos_pct;
    const taxas_brl = precoPraticado * input.taxas_comissoes_pct;
    margem_atual_brl = precoPraticado - custos_variaveis - impostos_brl - taxas_brl;
    margem_atual_pct = margem_atual_brl / precoPraticado;

    if (precoPraticado < preco_minimo) status = "abaixo_minimo";
    else if (precoPraticado < preco_alvo) status = "abaixo_alvo";
    else status = "acima_alvo";
  }

  return {
    custos_variaveis,
    preco_minimo,
    preco_alvo,
    margem_atual_brl,
    margem_atual_pct,
    status,
  };
}

// Calcula margem em BRL e % dado um preço hipotético (usado pela engine
// pra validar se um markdown respeita a trava de margem mínima).
export function computeMargin(
  input: CompositionInput,
  preco: number
): { margem_brl: number; margem_pct: number } {
  if (preco <= 0) return { margem_brl: 0, margem_pct: 0 };

  const custos_variaveis =
    input.cogs +
    input.frete_unitario +
    input.marketing_unitario +
    input.rateio_fixo;

  const impostos_brl = preco * input.impostos_pct;
  const taxas_brl = preco * input.taxas_comissoes_pct;
  const margem_brl = preco - custos_variaveis - impostos_brl - taxas_brl;
  const margem_pct = margem_brl / preco;

  return { margem_brl, margem_pct };
}
