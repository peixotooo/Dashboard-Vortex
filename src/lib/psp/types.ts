export type PspFamily =
  | "camiseta"
  | "regata"
  | "polo"
  | "bermuda"
  | "calca"
  | "blusao"
  | "moletom"
  | "jaqueta"
  | "acessorio"
  | "outro";

export type PspStockSource = "eccosys" | "hub_fallback" | "none";
export type PspActionKind =
  | "produce"
  | "preproduce"
  | "prepare_base"
  | "map_base"
  | "verify_stock";

export type PspSettings = {
  planning_horizon_days: number;
  safety_stock_days: number;
  production_lead_days: number;
  preproduction_days: number;
  launch_window_days: number;
  max_rolls_per_order: number;
  cash_budget_brl: number | null;
  min_momentum_units_7d: number;
  growth_threshold_pct: number;
  family_yields: Record<PspFamily, number>;
};

export type PspProductSetting = {
  sku: string;
  family: string | null;
  color: string | null;
  units_per_roll: number | null;
  lead_time_days: number | null;
  base_sku: string | null;
  made_to_order_override: boolean | null;
  active: boolean;
  notes?: string | null;
};

export type PspSaleItem = {
  sku?: string | null;
  reference?: string | null;
  name?: string | null;
  variant_name?: string | null;
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  quantity?: number | null;
  price?: number | null;
  total?: number | null;
};

export type PspSaleRow = {
  data_compra: string | null;
  items: PspSaleItem[] | null;
};

export type PspInventoryRow = {
  sku: string;
  parent_sku: string;
  product_id?: string | null;
  name?: string | null;
  stock_real: number;
  stock_available: number;
  captured_at: string;
};

export type PspHubRow = {
  sku: string;
  ecc_id?: number | null;
  ecc_pai_sku: string | null;
  nome: string | null;
  estoque: number | null;
  sob_demanda: boolean | null;
  atributos: Record<string, unknown> | null;
  preco?: number | null;
  preco_promocional?: number | null;
  last_ecc_sync?: string | null;
};

export type PspCatalogRow = {
  sku: string | null;
  name: string;
  category: string | null;
  price: number | null;
  sale_price: number | null;
  active: boolean | null;
};

export type PspCostRow = { sku: string; cost: number };
export type PspLaunchRow = { sku: string; launch_date: string; collection?: string | null };

export type PspFinancialInput = {
  product_cost_pct: number;
  tax_pct: number;
  other_expenses_pct: number;
};

export type PspEngineInput = {
  now?: Date;
  settings: PspSettings;
  productSettings: PspProductSetting[];
  sales: PspSaleRow[];
  inventory: PspInventoryRow[];
  hub: PspHubRow[];
  catalog: PspCatalogRow[];
  costs: PspCostRow[];
  launches: PspLaunchRow[];
  financial: PspFinancialInput;
};

export type PspGradeItem = {
  size: string;
  units: number;
  share_pct: number;
  sold_30d: number;
  stock_units: number | null;
};

export type PspAction = {
  id: string;
  rank: number;
  kind: PspActionKind;
  sku: string;
  name: string;
  family: PspFamily;
  color: string;
  abc_class: "A" | "B" | "C";
  made_to_order: boolean;
  severity: "critical" | "high" | "watch" | "data";
  priority_score: number;
  stock_source: PspStockSource;
  stock_units: number | null;
  coverage_days: number | null;
  sold_7d: number;
  sold_30d: number;
  forecast_daily: number;
  growth_pct: number | null;
  momentum: boolean;
  launch_age_days: number | null;
  units_per_roll: number;
  recommended_units: number;
  recommended_rolls: number;
  selected_units: number;
  selected_rolls: number;
  unit_cost: number | null;
  investment_brl: number | null;
  selected_investment_brl: number;
  revenue_at_risk_brl: number;
  margin_at_risk_brl: number;
  selected: boolean;
  excluded_reason: "cash" | "capacity" | "mapping" | "stock" | null;
  reasons: string[];
  grade: PspGradeItem[];
  base_sku: string | null;
  base_mapping: "configured" | "inferred" | "missing" | null;
  allocations?: Array<{ sku: string; name: string; units: number }>;
};

export type PspProductMonitorRow = {
  sku: string;
  name: string;
  abc_class: "A" | "B" | "C";
  made_to_order: boolean;
  family: PspFamily;
  color: string;
  stock_units: number | null;
  coverage_days: number | null;
  sold_7d: number;
  sold_30d: number;
  growth_pct: number | null;
  forecast_daily: number;
  momentum: boolean;
  launch_age_days: number | null;
};

export type PspPlan = {
  generated_at: string;
  settings: PspSettings;
  summary: {
    actionable_count: number;
    selected_action_count: number;
    critical_count: number;
    momentum_count: number;
    required_rolls: number;
    selected_rolls: number;
    required_investment_brl: number;
    selected_investment_brl: number;
    revenue_at_risk_brl: number;
    margin_at_risk_brl: number;
    revenue_protected_brl: number;
    margin_protected_brl: number;
    opportunity_outside_plan_brl: number;
  };
  data_quality: {
    sales_orders: number;
    products_with_sales: number;
    inventory_source: PspStockSource;
    inventory_captured_at: string | null;
    inventory_age_hours: number | null;
    stock_match_pct: number;
    tracked_cost_pct: number;
    made_to_order_count: number;
    made_to_order_registered_count: number;
    mapped_base_pct: number;
    warnings: string[];
  };
  actions: PspAction[];
  products: PspProductMonitorRow[];
};
