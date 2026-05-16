-- supabase/migration-081-pricing-combos.sql
--
-- Combos / pacotes do módulo de Pricing (Conceito 8 do SDD).
--
-- Combo = "leve N produtos por R$ X" — sobrepõe o pricing dinâmico e ajusta
-- ticket médio. Reusa o pattern de approval do engine: combo cadastrado fica
-- 'draft' → 'scheduled' → 'active' → 'expired'.
--
-- A aplicação no VNDA depende do tipo de combo:
--   - 'fixed_total' (3 tênis por R$ 199): cria desconto VNDA do tipo "bundle"
--   - 'percent_off' (10% pro 2º par): cupom progressivo
-- Esta migration apenas modela; o push pra VNDA fica pra implementação
-- futura quando o tipo de combo estiver consolidado em produção.

create table if not exists public.pricing_combos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  combo_type text not null default 'fixed_total'
    check (combo_type in ('fixed_total','percent_off')),

  -- SKUs participantes do combo
  sku_ids text[] not null default '{}',
  -- Tamanho do combo (3 tênis = 3 unidades)
  combo_size int not null default 1 check (combo_size >= 1),
  -- Preço fixo do combo (em fixed_total)
  combo_price_brl numeric(14,2),
  -- % de desconto (em percent_off)
  discount_pct numeric(6,4),

  -- Vigência
  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Metas e cálculos derivados (preenchidos na criação/update via API)
  meta_faturamento_brl numeric(14,2),
  cpa_breakeven_brl numeric(14,2),
  cobertura_estoque_dias int,

  status text not null default 'draft'
    check (status in ('draft','scheduled','active','expired','cancelled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pricing_combos_ws_status_idx
  on public.pricing_combos (workspace_id, status);

create index if not exists pricing_combos_active_window_idx
  on public.pricing_combos (workspace_id, starts_at, ends_at)
  where status in ('scheduled','active');

alter table public.pricing_combos enable row level security;

drop policy if exists "Members view pricing_combos" on public.pricing_combos;
create policy "Members view pricing_combos"
  on public.pricing_combos for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage pricing_combos" on public.pricing_combos;
create policy "Admins manage pricing_combos"
  on public.pricing_combos for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );
