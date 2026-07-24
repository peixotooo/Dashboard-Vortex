-- Migration 144: restrict operational iPORTO queue functions to trusted server code.
-- PostgreSQL grants EXECUTE to PUBLIC by default, including SECURITY DEFINER
-- functions, unless it is explicitly revoked.

create or replace function public.claim_iporto_envios(p_limit integer)
returns setof public.email_template_iporto_envios
language sql
security definer
set search_path = public
as $$
  update public.email_template_iporto_envios e
  set status = 'processing',
      attempts = attempts + 1,
      updated_at = now()
  where e.id in (
    select id
    from public.email_template_iporto_envios
    where status = 'pending'
      and next_attempt_at <= now()
    order by next_attempt_at, id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 0), 0), 1000)
  )
  returning *;
$$;

revoke all on function public.claim_iporto_envios(integer)
  from public, anon, authenticated;
grant execute on function public.claim_iporto_envios(integer) to service_role;

revoke all on function public.requeue_iporto_envio(bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.requeue_iporto_envio(bigint, text, integer)
  to service_role;

-- RLS helper functions intentionally run as their owner to avoid recursive
-- workspace_members policies. Keep them available to signed-in users only and
-- pin search_path so an attacker-controlled object can never shadow a table.
create or replace function public.get_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid();
$$;

create or replace function public.get_user_admin_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid()
    and role in ('owner', 'admin');
$$;

revoke all on function public.get_user_workspace_ids()
  from public, anon, authenticated;
revoke all on function public.get_user_admin_workspace_ids()
  from public, anon, authenticated;

grant execute on function public.get_user_workspace_ids()
  to authenticated, service_role;
grant execute on function public.get_user_admin_workspace_ids()
  to authenticated, service_role;

-- Trigger-only function: it should not be exposed as an RPC.
alter function public.handle_new_user() set search_path = public;
revoke all on function public.handle_new_user()
  from public, anon, authenticated;

-- Membership hierarchy is enforced by /api/workspaces. Earlier RLS policies
-- let an admin update or delete any workspace_members row directly, including
-- the owner, because row policies cannot distinguish the target hierarchy.
revoke insert, update, delete on table public.workspace_members
  from anon, authenticated;

-- Prevent direct owner_id changes or destructive workspace deletion. The
-- validated API route performs allowed name/slug/domain updates as service_role.
revoke update, delete on table public.workspaces
  from anon, authenticated;

-- auth.users is the source of truth for profile email. Keeping that column
-- immutable blocks an account from claiming another invitee's email.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, avatar_url) on table public.profiles to authenticated;
