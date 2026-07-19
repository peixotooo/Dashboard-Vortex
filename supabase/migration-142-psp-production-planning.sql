-- Planejamento inteligente de estoque e producao (PCP/PSP).
--
-- O estoque do Eccosys e persistido por SKU exato para evitar somar o mesmo
-- saldo replicado em varios anuncios do Mercado Livre. As configuracoes ficam
-- separadas dos dados calculados: o plano e sempre recalculado sobre vendas,
-- custos e estoque atuais.

create table if not exists public.psp_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  planning_horizon_days int not null default 30
    check (planning_horizon_days between 7 and 90),
  safety_stock_days int not null default 7
    check (safety_stock_days between 0 and 45),
  production_lead_days int not null default 10
    check (production_lead_days between 1 and 90),
  preproduction_days int not null default 7
    check (preproduction_days between 1 and 45),
  launch_window_days int not null default 60
    check (launch_window_days between 7 and 180),
  max_rolls_per_order int not null default 25
    check (max_rolls_per_order between 1 and 500),
  cash_budget_brl numeric(14,2)
    check (cash_budget_brl is null or cash_budget_brl >= 0),
  min_momentum_units_7d int not null default 4
    check (min_momentum_units_7d between 1 and 500),
  growth_threshold_pct numeric(8,2) not null default 30
    check (growth_threshold_pct between 0 and 1000),
  family_yields jsonb not null default '{
    "camiseta": 60,
    "regata": 60,
    "polo": 45,
    "bermuda": 45,
    "calca": 30,
    "blusao": 30,
    "moletom": 30,
    "jaqueta": 30,
    "acessorio": 30,
    "outro": 30
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.psp_product_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text not null,
  family text,
  color text,
  units_per_roll int check (units_per_roll is null or units_per_roll between 1 and 1000),
  lead_time_days int check (lead_time_days is null or lead_time_days between 1 and 180),
  base_sku text,
  made_to_order_override boolean,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, sku)
);

create index if not exists psp_product_settings_base_idx
  on public.psp_product_settings (workspace_id, base_sku)
  where base_sku is not null;

create table if not exists public.psp_inventory_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text not null,
  parent_sku text not null,
  product_id text,
  name text,
  stock_real int not null default 0,
  stock_available int not null default 0,
  source text not null default 'eccosys' check (source in ('eccosys', 'manual')),
  captured_at timestamptz not null default now(),
  primary key (workspace_id, sku)
);

create index if not exists psp_inventory_parent_idx
  on public.psp_inventory_snapshots (workspace_id, parent_sku);

create index if not exists psp_inventory_captured_idx
  on public.psp_inventory_snapshots (workspace_id, captured_at desc);

alter table public.psp_settings enable row level security;
alter table public.psp_product_settings enable row level security;
alter table public.psp_inventory_snapshots enable row level security;

drop policy if exists "Members view psp_settings" on public.psp_settings;
create policy "Members view psp_settings"
  on public.psp_settings for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage psp_settings" on public.psp_settings;
create policy "Admins manage psp_settings"
  on public.psp_settings for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists "Members view psp_product_settings" on public.psp_product_settings;
create policy "Members view psp_product_settings"
  on public.psp_product_settings for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage psp_product_settings" on public.psp_product_settings;
create policy "Admins manage psp_product_settings"
  on public.psp_product_settings for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists "Members view psp_inventory_snapshots" on public.psp_inventory_snapshots;
create policy "Members view psp_inventory_snapshots"
  on public.psp_inventory_snapshots for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage psp_inventory_snapshots" on public.psp_inventory_snapshots;
create policy "Admins manage psp_inventory_snapshots"
  on public.psp_inventory_snapshots for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
