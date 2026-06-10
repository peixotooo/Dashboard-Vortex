-- Migration 118: per-workspace Meta CAPI credentials.
--
-- Allows each workspace to point CAPI at its own Meta Pixel without changing
-- environment variables. Access tokens are encrypted by the app before storage.

create table if not exists public.meta_capi_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  pixel_id text,
  access_token_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_capi_settings
  add column if not exists pixel_id text;

alter table public.meta_capi_settings
  add column if not exists access_token_encrypted text;

alter table public.meta_capi_settings enable row level security;

drop policy if exists "Members view meta_capi_settings" on public.meta_capi_settings;
create policy "Members view meta_capi_settings"
  on public.meta_capi_settings for select
  using (
    workspace_id in (
      select workspace_id
      from public.workspace_members
      where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage meta_capi_settings" on public.meta_capi_settings;
create policy "Admins manage meta_capi_settings"
  on public.meta_capi_settings for all
  using (
    workspace_id in (
      select workspace_id
      from public.workspace_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  )
  with check (
    workspace_id in (
      select workspace_id
      from public.workspace_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );
