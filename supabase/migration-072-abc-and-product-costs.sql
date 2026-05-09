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
--
-- Fallback de custo (quando product_costs não tem o SKU) vem de
-- workspace_financial_settings.product_cost_pct — mesma fonte que o
-- commercial-simulator usa pra margem. Não precisa coluna nova aqui.

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

-- 3. Fallback de custo de produto vem de workspace_financial_settings
--    .product_cost_pct (mesma fonte que o commercial-simulator usa pra
--    margem). product_costs.cost por SKU sempre ganha quando existe.
--    Não precisa de coluna nova aqui — só garantir que financial
--    settings exista (criada em migration anterior do simulador).
