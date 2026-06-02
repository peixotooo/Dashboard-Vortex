// src/lib/financeiro/defaults.ts
//
// FONTE ÚNICA dos defaults financeiros do workspace.
//
// Antes esses números viviam copiados em 4+ lugares (financial-settings
// route, cockpit-caixa route, simulador/config, retention-playbooks…) e
// divergiam entre si: annual_revenue_target era 8M num módulo e 9M no
// fallback de outro; desconto 3% aqui e 6% lá; frete 18 num import e 25
// no simulador-comercial. Isso fazia a MESMA campanha ser "champion" num
// módulo e "potential" noutro, e o ABC dizer lucrativo enquanto o
// simulador dizia margem vermelha.
//
// Regra: NINGUÉM redeclara esses defaults. Importe FIN_DEFAULTS daqui.

export interface FinancialSettingsShape {
  /** Custos fixos mensais (aluguel, folha, software…). BRL. */
  monthly_fixed_costs: number;
  /** Impostos como % do preço de venda. */
  tax_pct: number;
  /** CMV (custo do produto) como % do preço, usado SÓ quando o SKU não
   *  tem custo real cadastrado em product_costs. É o fallback circular —
   *  ver coverage_pct para saber quanto da receita depende dele. */
  product_cost_pct: number;
  /** Outras despesas variáveis (taxa de gateway/parcelamento, embalagem,
   *  SAC rateado…) como % do preço. */
  other_expenses_pct: number;
  /** Distribuição da receita anual por mês (jan..dez), em %. Soma ~100.
   *  HOJE é estático/digitado à mão — não derivado de crm_vendas. */
  monthly_seasonality: number[];
  /** Meta de lucro mensal. BRL. 0 = só cobrir custos (breakeven). */
  target_profit_monthly: number;
  /** Margem de segurança (em pontos percentuais) descontada do espaço de
   *  ads ao calcular o MER "saudável". SUBSTITUI o número mágico -8 que
   *  estava cravado em campaigns/route.ts. Configurável por workspace. */
  safety_margin_pct: number;
  /** Meta de faturamento anual. Âncora das metas mensais sazonalizadas. */
  annual_revenue_target: number;
  /** Investimento em ads planejado como % da receita. */
  invest_pct: number;
  /** Frete como % da receita. */
  frete_pct: number;
  /** Desconto médio concedido como % da receita. */
  desconto_pct: number;
  /** Piso de caixa diário desejado. BRL. */
  daily_cash_floor_brl: number;
  /** Custo médio de frete absorvido (frete grátis) por pedido. BRL. */
  custo_frete_medio_brl: number;
}

/**
 * Sazonalidade default. ATENÇÃO: é uma hipótese estática, não um fato
 * medido. Ver [[sazonalidade]] no glossário — idealmente deveria vir de
 * uma decomposição da série real de crm_vendas (que ainda não existe
 * porque os snapshots se sobrescrevem).
 */
export const DEFAULT_SEASONALITY: number[] = [
  6.48, 5.78, 7.53, 7.2, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98,
];

export const FIN_DEFAULTS: FinancialSettingsShape = {
  monthly_fixed_costs: 160000,
  tax_pct: 6,
  product_cost_pct: 25,
  other_expenses_pct: 5,
  monthly_seasonality: DEFAULT_SEASONALITY,
  target_profit_monthly: 0,
  safety_margin_pct: 5,
  annual_revenue_target: 8000000,
  invest_pct: 12,
  frete_pct: 6,
  desconto_pct: 3,
  daily_cash_floor_brl: 15500,
  custo_frete_medio_brl: 18,
};

/** Lê um número de um objeto solto (settings vindo da API) caindo no
 *  default canônico quando ausente/ inválido. Evita o padrão `?? 9000000`
 *  divergente espalhado pelo código. */
export function finNumber(
  source: Record<string, unknown> | null | undefined,
  key: keyof FinancialSettingsShape,
  fallback: number = FIN_DEFAULTS[key] as number
): number {
  const raw = source?.[key];
  const n = typeof raw === "string" ? Number(raw) : (raw as number | undefined);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** Normaliza um settings parcial vindo do banco para o shape completo,
 *  preenchendo defaults. Use no topo de cada rota/página em vez de
 *  redeclarar defaults locais. */
export function withFinDefaults(
  source: Partial<FinancialSettingsShape> | null | undefined
): FinancialSettingsShape {
  const s = source ?? {};
  const seasonality =
    Array.isArray(s.monthly_seasonality) && s.monthly_seasonality.length === 12
      ? s.monthly_seasonality
      : DEFAULT_SEASONALITY;
  return {
    monthly_fixed_costs: finNumber(s, "monthly_fixed_costs"),
    tax_pct: finNumber(s, "tax_pct"),
    product_cost_pct: finNumber(s, "product_cost_pct"),
    other_expenses_pct: finNumber(s, "other_expenses_pct"),
    monthly_seasonality: seasonality,
    target_profit_monthly: finNumber(s, "target_profit_monthly"),
    safety_margin_pct: finNumber(s, "safety_margin_pct"),
    annual_revenue_target: finNumber(s, "annual_revenue_target"),
    invest_pct: finNumber(s, "invest_pct"),
    frete_pct: finNumber(s, "frete_pct"),
    desconto_pct: finNumber(s, "desconto_pct"),
    daily_cash_floor_brl: finNumber(s, "daily_cash_floor_brl"),
    custo_frete_medio_brl: finNumber(s, "custo_frete_medio_brl"),
  };
}
