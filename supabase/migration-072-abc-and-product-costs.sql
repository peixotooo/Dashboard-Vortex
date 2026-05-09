-- supabase/migration-072-abc-and-product-costs.sql
--
-- Foundation pra curva ABC própria + lucratividade por venda. Vem
-- diretamente do webhook VNDA: o webhook já popula crm_vendas.items com
-- sku/quantity/price/total (a partir de migration A do plano de
-- inteligência), e essa migration adiciona os pedaços que faltam:
--
--   1. product_costs — custo por SKU (CMV). Sem isso "lucro" é
--      estimativa baseada em margem default. Tabela é workspace-scoped
--      pra cada loja gerenciar seus próprios custos sem vazar entre
--      tenants.
--   2. crm_abc_snapshots — snapshot pré-computado da curva ABC + lista
--      de lucratividade. Mesma estratégia de crm_rfm_snapshots: cron
--      gera, frontend lê. Evita recomputar a cada page-view e mantém
--      determinismo entre múltiplos consumidores (picker / reports
--      dashboard / exports).
--   3. email_template_settings.default_margin_pct — fallback usado pra
--      estimar custo quando product_costs não tem o SKU. 0.5 = 50% de
--      margem (vestuário típico). Configurável por workspace.

-- 1. Custo por SKU (workspace-scoped)
create table if not exists product_costs (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sku text not null,
  -- Custo unitário em BRL. Inclui CMV; impostos/frete/taxas ficam pro
  -- cálculo de profitability na hora.
  cost numeric not null check (cost >= 0),
  currency text default 'BRL' not null,
  -- 'manual' (UI), 'csv' (bulk upload), 'integration' (futuro: ERP)
  source text default 'manual' not null,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (workspace_id, sku)
);

create index if not exists product_costs_workspace_idx
  on product_costs (workspace_id);

-- 2. Snapshot ABC + profitability
create table if not exists crm_abc_snapshots (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  -- Janela considerada na curva. Default 90 dias (matches o
  -- bestseller_lookback_days da Frente B).
  period_days int not null default 90,
  -- Per-product breakdown. Cada item tem:
  --   { sku, product_id, name, qty_sold, revenue, cost_unit, cost_total,
  --     profit, margin_pct, abc_class, cumulative_revenue_pct,
  --     cost_source: 'tracked' | 'estimated' }
  products jsonb not null default '[]'::jsonb,
  -- Per-order profitability. Cada item tem:
  --   { order_id, numero_pedido, customer_email, valor, items_revenue,
  --     items_cost, fees_estimated, shipping_diff, discount_total,
  --     profit, margin_pct, status: 'profit' | 'loss' | 'breakeven',
  --     data_compra }
  orders jsonb not null default '[]'::jsonb,
  -- Summary agregado. { total_revenue, total_cost, total_profit,
  --   gross_margin_pct, a_count, b_count, c_count, profitable_orders,
  --   loss_orders, breakeven_orders, period_start, period_end,
  --   coverage_pct (% das vendas que tem custo trackeado) }
  summary jsonb not null default '{}'::jsonb,
  -- # de rows de crm_vendas considerados.
  row_count int default 0,
  computed_at timestamptz default now() not null
);

-- 3. Margin default no settings (fallback quando product_costs não tem o SKU)
alter table email_template_settings
  add column if not exists default_margin_pct numeric default 0.5
    check (default_margin_pct >= 0 and default_margin_pct <= 1);

comment on column email_template_settings.default_margin_pct is
  'Margem assumida quando product_costs não tem o SKU (0.0..1.0). '
  'Usado pelo compute ABC pra estimar custo: cost = price × (1 - margin).';
