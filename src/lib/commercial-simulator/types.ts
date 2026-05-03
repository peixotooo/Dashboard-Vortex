export type Veredicto = "verde" | "amarelo" | "vermelho";

export type SimulateInput = {
  precoCheio: number;
  descontoPct: number;
  freteGratis: boolean;
  custoProdutoPct: number;
  taxPct: number;
  outrasDespesasPct: number;
  custoFreteMedioBrl: number;
  pisoMargemPct: number;
  bufferZonaVerdePct: number;
};

export type SimulateOutput = {
  precoLiquido: number;
  descontoBrl: number;
  cmvBrl: number;
  impostosBrl: number;
  outrosBrl: number;
  freteAbsorvidoBrl: number;
  custoTotal: number;
  margemBrl: number;
  margemPct: number;
  veredicto: Veredicto;
  explicacao: string;
  sugestoes: string[];
};

export type CommercialSimulatorSettings = {
  piso_margem_pct: number;
  buffer_zona_verde_pct: number;
  custo_frete_medio_brl: number;
  ticket_minimo_frete_gratis_brl: number;
};

export type CombinedSettings = CommercialSimulatorSettings & {
  product_cost_pct: number;
  tax_pct: number;
  other_expenses_pct: number;
  isDefault: boolean;
};

export type SkuLookup = {
  codigo: string;
  nome: string;
  precoCheio: number;
  salePrice: number | null;
  estoque: number | null;
  categoria: string | null;
  imagem: string | null;
  inStock: boolean;
};

export type Gatilho =
  | "queima_estoque"
  | "campanha_datada"
  | "lancamento"
  | "recuperacao_carrinho"
  | "competitivo"
  | "outro";

export type Baseline = {
  inicio: string;
  fim: string;
  totalReceita: number;
  numPedidos: number;
  ticketMedio: number;
  diasComVenda: number;
  receitaMediaDiaria: number;
};

export type MacroSimulateInput = {
  baseline: Baseline;
  descontoPct: number;
  coberturaPct: number;
  incrementoVendasPct: number;
  freteGratisCobertura: number;
  custoProdutoPct: number;
  taxPct: number;
  outrasDespesasPct: number;
  adsPct: number;
  incluirAds: boolean;
  custoFreteMedioBrl: number;
  custoFixoMensal: number;
  pisoMargemPct: number;
  bufferZonaVerdePct: number;
};

export type CenarioAggregate = {
  receita: number;
  margemBrl: number;
  margemPct: number;
  adsBrl: number;
  custoFixo: number;
  lucroOperacional: number;
  numPedidos: number;
  ticketMedio: number;
};

export type MacroSimulateOutput = {
  projetadoMensal: CenarioAggregate;
  historicoMensal: CenarioAggregate;
  deltaReceita: number;
  deltaMargemBrl: number;
  deltaMargemPct: number;
  deltaLucroOperacional: number;
  veredicto: Veredicto;
  explicacao: string;
};

export const GATILHOS: { value: Gatilho; label: string }[] = [
  { value: "queima_estoque", label: "Queima de estoque" },
  { value: "campanha_datada", label: "Campanha datada (Black Friday, aniversário)" },
  { value: "lancamento", label: "Lançamento (primeiros 30 dias)" },
  { value: "recuperacao_carrinho", label: "Recuperação de carrinho abandonado" },
  { value: "competitivo", label: "Resposta a movimento competitivo" },
  { value: "outro", label: "Outro (descreva no campo abaixo)" },
];
