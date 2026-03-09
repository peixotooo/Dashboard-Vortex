-- Migration 020: Financial settings per workspace
-- Used by Simulador and Overview for break-even / target calculations

create table if not exists workspace_financial_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  monthly_fixed_costs numeric default 160000,
  tax_pct numeric default 6,
  product_cost_pct numeric default 25,
  other_expenses_pct numeric default 5,
  monthly_seasonality jsonb default '[6.48, 5.78, 7.53, 7.20, 8.65, 8.36, 8.71, 9.08, 8.39, 7.95, 12.88, 8.98]',
  target_profit_monthly numeric default 0,
  safety_margin_pct numeric default 5,
  updated_at timestamptz default now()
);

-- RLS
alter table workspace_financial_settings enable row level security;

create policy "Members can view financial settings"
  on workspace_financial_settings for select
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

create policy "Admins can update financial settings"
  on workspace_financial_settings for all
  using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
