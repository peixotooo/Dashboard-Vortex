-- Migration 117: workspace-level Meta CAPI toggle.
--
-- The Meta CAPI credentials still live in server env vars, but operators need
-- a per-workspace kill switch from the dashboard so they can pause event
-- forwarding without a deploy.

create table if not exists public.meta_capi_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
