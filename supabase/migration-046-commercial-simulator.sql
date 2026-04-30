-- Migration 046: Commercial Simulator settings per workspace
-- Used by /simulador-comercial to compute discount floors, freight absorption thresholds
-- and zone verdicts (verde/amarelo/vermelho) per SKU.

create table if not exists commercial_simulator_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  piso_margem_pct numeric(5,2) default 15.00,
  buffer_zona_verde_pct numeric(5,2) default 5.00,
  custo_frete_medio_brl numeric(10,2) default 25.00,
  ticket_minimo_frete_gratis_brl numeric(10,2) default 199.00,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table commercial_simulator_settings enable row level security;

create policy "Members can view commercial simulator settings"
  on commercial_simulator_settings for select
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

create policy "Admins can update commercial simulator settings"
  on commercial_simulator_settings for all
  using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
