-- VNDA e-commerce connections (SaaS-ready, per-workspace)

create table if not exists public.vnda_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  api_token text not null,
  store_host text not null,
  store_name text,
  is_default boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table public.vnda_connections enable row level security;

create policy "Members can view VNDA connections"
  on public.vnda_connections for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Admins can manage VNDA connections"
  on public.vnda_connections for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'owner')
    )
  );

-- Index
create index if not exists idx_vnda_connections_workspace
  on public.vnda_connections (workspace_id);
