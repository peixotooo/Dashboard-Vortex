-- supabase/migration-082-sku-launch-dates.sql
--
-- Data de lançamento por SKU (referência pai), usada como proxy de idade pelo
-- engine de pricing. Fonte: relatório de coleções exportado periodicamente.
--
-- Por que tabela nova em vez de coluna em sku_pricing:
--   - sku_pricing é composição de preço; data de lançamento é metadata operacional
--   - tabela única responsabilidade facilita reimport bulk (replace por workspace)
--   - permite ter coleção (collection) e source pra rastrear origem do dado

create table if not exists public.sku_launch_dates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku text not null,
  launch_date date not null,
  collection text,
  source text not null default 'report' check (source in ('report','manual','derived')),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, sku)
);

create index if not exists sku_launch_dates_workspace_idx
  on public.sku_launch_dates (workspace_id);

alter table public.sku_launch_dates enable row level security;

drop policy if exists "Members view sku_launch_dates" on public.sku_launch_dates;
create policy "Members view sku_launch_dates"
  on public.sku_launch_dates for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage sku_launch_dates" on public.sku_launch_dates;
create policy "Admins manage sku_launch_dates"
  on public.sku_launch_dates for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );
