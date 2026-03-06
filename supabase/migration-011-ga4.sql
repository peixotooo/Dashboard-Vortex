-- GA4 connections (for future multi-tenant support)
-- For now, credentials are stored in env vars (GA4_PROPERTY_ID, GA4_CREDENTIALS_JSON)

create table if not exists public.ga4_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  property_id text not null,
  property_name text,
  credentials_json text not null, -- encrypted with AES-256-GCM
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table public.ga4_connections enable row level security;

create policy "Members can view GA4 connections"
  on public.ga4_connections for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Admins can manage GA4 connections"
  on public.ga4_connections for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'owner')
    )
  );
