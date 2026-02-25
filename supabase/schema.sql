-- ============================================
-- Dashboard Vortex - Supabase Schema
-- Execute this in the Supabase SQL Editor
-- ============================================

-- 1. Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Workspaces (tenants)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.workspaces enable row level security;

-- 3. Workspace Members
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

alter table public.workspace_members enable row level security;

-- RLS: Users can see workspaces they belong to
create policy "Members can view workspace"
  on public.workspaces for select
  using (
    id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Owners and admins can update workspace"
  on public.workspaces for update
  using (
    id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Any user can create workspace"
  on public.workspaces for insert
  with check (owner_id = auth.uid());

create policy "Owners can delete workspace"
  on public.workspaces for delete
  using (owner_id = auth.uid());

-- RLS for workspace_members
create policy "Members can view members of their workspaces"
  on public.workspace_members for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Admins and owners can insert members"
  on public.workspace_members for insert
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Admins and owners can delete members"
  on public.workspace_members for delete
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- 4. Meta Connections (tokens per workspace)
create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  access_token text not null,
  app_id text,
  token_expires_at timestamptz,
  created_at timestamptz default now()
);

alter table public.meta_connections enable row level security;

create policy "Members can view workspace connections"
  on public.meta_connections for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Admins and owners can manage connections"
  on public.meta_connections for insert
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Admins and owners can update connections"
  on public.meta_connections for update
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Admins and owners can delete connections"
  on public.meta_connections for delete
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- 5. Meta Accounts (linked ad accounts per workspace)
create table if not exists public.meta_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  account_id text not null,
  account_name text,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

alter table public.meta_accounts enable row level security;

create policy "Members can view workspace accounts"
  on public.meta_accounts for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "Admins and owners can manage accounts"
  on public.meta_accounts for insert
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Admins and owners can delete accounts"
  on public.meta_accounts for delete
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Admins and owners can update accounts"
  on public.meta_accounts for update
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Policy: members can view profiles of workspace colleagues
create policy "Members can view workspace member profiles"
  on public.profiles for select
  using (
    id in (
      select wm.user_id from public.workspace_members wm
      where wm.workspace_id in (
        select workspace_id from public.workspace_members
        where user_id = auth.uid()
      )
    )
  );

-- Auto-create workspace on first login (via trigger on profiles)
create or replace function public.handle_new_profile()
returns trigger as $$
declare
  ws_id uuid;
  ws_slug text;
begin
  -- Generate a unique slug
  ws_slug := 'workspace-' || substr(new.id::text, 1, 8);

  -- Create default workspace
  insert into public.workspaces (name, slug, owner_id)
  values (coalesce(new.full_name, 'Meu Workspace') || '''s Workspace', ws_slug, new.id)
  returning id into ws_id;

  -- Add user as owner
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();
