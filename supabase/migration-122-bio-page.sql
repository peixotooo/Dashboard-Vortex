-- Migration 122: Bio inteligente
-- Link da bio proprio com blocos dinamicos e tracking de eventos.

create table if not exists public.bio_page_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  slug text not null default 'bulking',
  public_domain text not null default 'bio.bulking.com.br',
  store_base_url text not null default 'https://www.bulking.com.br',
  brand_name text not null default 'Bulking',
  headline text not null default 'Bulking',
  subtitle text not null default 'Tudo que esta acontecendo agora: ofertas, produtos mais vendidos, grupo VIP e beneficios.',
  avatar_url text,
  default_utm_campaign text not null default 'instagram_bio',
  blocks jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bio_page_configs_domain
  on public.bio_page_configs (public_domain)
  where enabled = true;

create table if not exists public.bio_page_events (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id text,
  event_name text not null,
  block_id text,
  block_type text,
  destination_url text,
  product_id text,
  category text,
  campaign_id text,
  referrer text,
  user_agent text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bio_page_events_workspace_day
  on public.bio_page_events (workspace_id, created_at desc);

create index if not exists idx_bio_page_events_event
  on public.bio_page_events (workspace_id, event_name, created_at desc);

create index if not exists idx_bio_page_events_block
  on public.bio_page_events (workspace_id, block_id, created_at desc);

alter table public.bio_page_configs enable row level security;
alter table public.bio_page_events enable row level security;

drop policy if exists "Members view bio_page_configs" on public.bio_page_configs;
create policy "Members view bio_page_configs"
  on public.bio_page_configs for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage bio_page_configs" on public.bio_page_configs;
create policy "Admins manage bio_page_configs"
  on public.bio_page_configs for all
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists "Members view bio_page_events" on public.bio_page_events;
create policy "Members view bio_page_events"
  on public.bio_page_events for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create or replace function public.update_bio_page_configs_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bio_page_configs_timestamp on public.bio_page_configs;
create trigger bio_page_configs_timestamp
  before update on public.bio_page_configs
  for each row execute function public.update_bio_page_configs_timestamp();
