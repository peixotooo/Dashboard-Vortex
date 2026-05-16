-- supabase/migration-080-pricing.sql
--
-- Módulo de Pricing / Precificação Dinâmica.
--
-- Três tabelas:
--   1. sku_pricing — composição de preço por SKU (custos, impostos, margem alvo)
--   2. sku_pricing_history — snapshot diário (idade, cobertura, preço de/por,
--      margem) + fila de aprovação de mudanças geradas pela engine.
--   3. pricing_engine_settings — parâmetros do engine por workspace
--      (modo agressivo/regular/conservador, cadência, regras de markdown/markup).
--
-- COGS continua vindo de product_costs (migration-072) — sku_pricing complementa
-- com componentes que faltam (frete unitário, marketing unitário, taxas,
-- rateio fixo, margem alvo).
--
-- Hierarquia de preço (decrescente): combo > campanha manual > cupom
-- automático legacy > pricing dinâmico. promo_coupon_plans ganha um
-- pricing_pillar para sinalizar qual pilar está governando o desconto.

-- ============================================================
-- 1. sku_pricing — composição de preço por SKU
-- ============================================================
create table if not exists public.sku_pricing (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text not null,

  -- Componentes de custo por unidade (BRL)
  frete_unitario numeric(14,2) not null default 0 check (frete_unitario >= 0),
  marketing_unitario numeric(14,2) not null default 0 check (marketing_unitario >= 0),
  rateio_fixo numeric(14,2) not null default 0 check (rateio_fixo >= 0),

  -- Componentes percentuais (frações: 0.06 = 6%)
  taxas_comissoes_pct numeric(6,4) not null default 0 check (taxas_comissoes_pct >= 0 and taxas_comissoes_pct < 1),
  impostos_pct numeric(6,4) not null default 0 check (impostos_pct >= 0 and impostos_pct < 1),
  margem_alvo_pct numeric(6,4) not null default 0 check (margem_alvo_pct >= 0 and margem_alvo_pct < 1),

  -- Preços calculados (recomputados na write — fonte de verdade fica na app
  -- mas mantemos snapshot pra facilitar queries analíticas)
  preco_minimo_calc numeric(14,2),
  preco_alvo_calc numeric(14,2),

  -- 'manual' (UI), 'csv' (upload), 'integration' (futuro: ERP)
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (workspace_id, sku)
);

create index if not exists sku_pricing_workspace_idx
  on public.sku_pricing (workspace_id);

alter table public.sku_pricing enable row level security;

drop policy if exists "Members view sku_pricing" on public.sku_pricing;
create policy "Members view sku_pricing"
  on public.sku_pricing for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage sku_pricing" on public.sku_pricing;
create policy "Admins manage sku_pricing"
  on public.sku_pricing for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- ============================================================
-- 2. sku_pricing_history — snapshot diário + fila de aprovação
-- ============================================================
create table if not exists public.sku_pricing_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text not null,
  snapshot_date date not null default current_date,

  -- Estado do estoque/vendas no dia
  idade_dias int not null default 0,
  cobertura_dias int,
  stock_units int not null default 0,
  vendas_dia_unidades numeric(10,4) not null default 0,

  -- Preço e desconto
  preco_de numeric(14,2) not null,
  preco_por numeric(14,2) not null,
  desconto_pct numeric(6,4) not null default 0,
  margem_brl numeric(14,2),
  margem_pct numeric(6,4),

  -- Classificação do evento que gerou esse snapshot
  evento text not null default 'baseline'
    check (evento in ('baseline','markdown','markup','campanha','combo','manual','hold')),

  -- Pilar ativo (qual lógica de pricing governou o preço final)
  pilar_ativo text not null default 'dinamico'
    check (pilar_ativo in ('dinamico','campanha','combo','manual')),

  -- Detalhes da regra aplicada pelo engine (modo, thresholds, trava)
  rule_applied jsonb not null default '{}'::jsonb,

  -- Fila de aprovação manual em lote
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','applied','skipped')),
  status_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,

  -- Ref opcional a uma campanha (promo_coupon_plans)
  plan_id uuid,

  created_at timestamptz not null default now()
);

-- Um snapshot por (workspace, sku, dia, evento) — permite múltiplas linhas
-- por dia se o engine roda duas vezes (preview + apply), distintas por evento.
create unique index if not exists sku_pricing_history_unique_daily
  on public.sku_pricing_history (workspace_id, sku, snapshot_date, evento);

create index if not exists sku_pricing_history_ws_date_idx
  on public.sku_pricing_history (workspace_id, snapshot_date desc);

create index if not exists sku_pricing_history_pending_idx
  on public.sku_pricing_history (workspace_id, status)
  where status in ('pending','approved');

create index if not exists sku_pricing_history_sku_idx
  on public.sku_pricing_history (workspace_id, sku, snapshot_date desc);

alter table public.sku_pricing_history enable row level security;

drop policy if exists "Members view sku_pricing_history" on public.sku_pricing_history;
create policy "Members view sku_pricing_history"
  on public.sku_pricing_history for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage sku_pricing_history" on public.sku_pricing_history;
create policy "Admins manage sku_pricing_history"
  on public.sku_pricing_history for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- ============================================================
-- 3. pricing_engine_settings — config do engine por workspace
-- ============================================================
create table if not exists public.pricing_engine_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,

  modo text not null default 'regular'
    check (modo in ('agressivo','regular','conservador')),
  cadencia text not null default 'semanal'
    check (cadencia in ('diaria','semanal')),
  -- Dia da semana pra rodar (0=domingo, 1=segunda, ...). Só vale se cadencia='semanal'.
  cadencia_dia_semana int not null default 1 check (cadencia_dia_semana between 0 and 6),

  -- Janela de vendas pra calcular cobertura (média móvel em dias)
  cobertura_janela_dias int not null default 14 check (cobertura_janela_dias between 7 and 90),

  -- Mark Down thresholds
  markdown_idade_min int not null default 30,
  markdown_cobertura_min int not null default 30,
  markdown_soma_min int not null default 90,
  markdown_desconto_inicial_pct numeric(6,4) not null default 0.10,
  markdown_incremento_pct numeric(6,4) not null default 0.07,

  -- Mark Up thresholds
  markup_idade_max int not null default 30,
  markup_cobertura_max int not null default 15,
  markup_margem_max_pct numeric(6,4) not null default 0.20,
  markup_reducao_pct numeric(6,4) not null default 0.05,

  -- Trava de margem mínima — engine nunca propõe preço abaixo disso
  trava_margem_minima_pct numeric(6,4) not null default 0.10,

  -- Approval workflow: se true, decisões caem em pending e exigem aprovação manual
  require_approval boolean not null default true,
  enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pricing_engine_settings enable row level security;

drop policy if exists "Members view pricing_engine_settings" on public.pricing_engine_settings;
create policy "Members view pricing_engine_settings"
  on public.pricing_engine_settings for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage pricing_engine_settings" on public.pricing_engine_settings;
create policy "Admins manage pricing_engine_settings"
  on public.pricing_engine_settings for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- ============================================================
-- 4. Extensão de promo_coupon_plans pra sinalizar pilar
-- ============================================================
-- Sinaliza qual pilar do módulo de pricing está governando o cupom. Quando
-- override_dynamic=true, o engine pula SKUs com cupom ativo (não propõe
-- markdown/markup em cima).
alter table public.promo_coupon_plans
  add column if not exists pricing_pillar text default 'dinamico'
    check (pricing_pillar in ('dinamico','campanha','combo'));

alter table public.promo_coupon_plans
  add column if not exists override_dynamic boolean not null default true;
