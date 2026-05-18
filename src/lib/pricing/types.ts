// Tipos compartilhados do módulo de Pricing.
//
// Percentuais são armazenados como frações decimais (0.06 = 6%) — mesmo padrão
// do schema Supabase (migration-080) e dos JSON payloads das rotas API.

export type PricingSource = "manual" | "csv" | "integration";

export type EngineMode = "agressivo" | "regular" | "conservador";

export type EngineCadence = "diaria" | "semanal";

export type PricingEvent =
  | "baseline"
  | "markdown"
  | "markup"
  | "campanha"
  | "combo"
  | "manual"
  | "hold";

export type PricingPillar = "dinamico" | "campanha" | "combo" | "manual";

export type HistoryStatus = "pending" | "approved" | "rejected" | "applied" | "skipped";

export type SkuPricing = {
  workspace_id: string;
  sku: string;
  frete_unitario: number;
  marketing_unitario: number;
  rateio_fixo: number;
  taxas_comissoes_pct: number;
  impostos_pct: number;
  margem_alvo_pct: number;
  preco_minimo_calc: number | null;
  preco_alvo_calc: number | null;
  source: PricingSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CompositionInput = {
  cogs: number;
  frete_unitario: number;
  marketing_unitario: number;
  rateio_fixo: number;
  taxas_comissoes_pct: number;
  impostos_pct: number;
  margem_alvo_pct: number;
};

export type CompositionOutput = {
  custos_variaveis: number;
  preco_minimo: number;
  preco_alvo: number;
  margem_atual_brl: number | null;
  margem_atual_pct: number | null;
  status: "ok" | "abaixo_minimo" | "abaixo_alvo" | "acima_alvo";
};

export type EngineSettings = {
  workspace_id: string;
  modo: EngineMode;
  cadencia: EngineCadence;
  cadencia_dia_semana: number;
  cobertura_janela_dias: number;
  markdown_idade_min: number;
  markdown_cobertura_min: number;
  markdown_soma_min: number;
  markdown_desconto_inicial_pct: number;
  markdown_incremento_pct: number;
  markup_idade_max: number;
  markup_cobertura_max: number;
  markup_margem_max_pct: number;
  markup_reducao_pct: number;
  trava_margem_minima_pct: number;
  // Trava escalonada por idade (canônica G4, padrão da indústria de moda).
  // Quando habilitada, engine usa a faixa correspondente à idade do SKU
  // em vez da trava flat acima.
  trava_por_idade_enabled: boolean;
  trava_idade_1_30_pct: number;
  trava_idade_31_90_pct: number;
  trava_idade_91_120_pct: number;
  trava_idade_121_plus_pct: number;
  // Tags VNDA (shelf_products.tags) que fazem o engine pular o SKU 100%.
  // Override manual — default vazio.
  engine_excluded_tags: string[];
  // Tag VNDA que identifica produtos em combo. Engine simula combo no cálculo
  // de margem (não exclui o SKU).
  combo_tag: string;
  // Pior cenário de desconto por unidade no combo (R$). Subtraído da receita
  // ao validar trava de margem em SKUs com combo_tag.
  combo_desconto_unitario_brl: number;
  require_approval: boolean;
  enabled: boolean;
};

export type PricingHistorySnapshot = {
  id: string;
  workspace_id: string;
  sku: string;
  snapshot_date: string;
  idade_dias: number;
  cobertura_dias: number | null;
  stock_units: number;
  vendas_dia_unidades: number;
  preco_de: number;
  preco_por: number;
  desconto_pct: number;
  margem_brl: number | null;
  margem_pct: number | null;
  evento: PricingEvent;
  pilar_ativo: PricingPillar;
  rule_applied: Record<string, unknown>;
  status: HistoryStatus;
  status_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  plan_id: string | null;
  created_at: string;
};

export const ENGINE_MODE_MULTIPLIERS: Record<EngineMode, number> = {
  agressivo: 1.5,
  regular: 1.0,
  conservador: 0.6,
};

export const DEFAULT_ENGINE_SETTINGS: Omit<EngineSettings, "workspace_id"> = {
  modo: "regular",
  cadencia: "semanal",
  cadencia_dia_semana: 1,
  cobertura_janela_dias: 14,
  markdown_idade_min: 30,
  markdown_cobertura_min: 30,
  markdown_soma_min: 90,
  markdown_desconto_inicial_pct: 0.10,
  markdown_incremento_pct: 0.07,
  markup_idade_max: 30,
  markup_cobertura_max: 15,
  markup_margem_max_pct: 0.20,
  markup_reducao_pct: 0.05,
  trava_margem_minima_pct: 0.25,
  trava_por_idade_enabled: true,
  trava_idade_1_30_pct: 0.35,
  trava_idade_31_90_pct: 0.25,
  trava_idade_91_120_pct: 0.15,
  trava_idade_121_plus_pct: 0.05,
  engine_excluded_tags: [],
  combo_tag: "combos",
  combo_desconto_unitario_brl: 6.37,
  require_approval: true,
  enabled: false,
};
