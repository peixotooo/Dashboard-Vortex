-- Migration 145: shared rate-limit buckets for public/serverless endpoints.

create table if not exists public.security_rate_limits (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start)
);

create index if not exists security_rate_limits_expires_idx
  on public.security_rate_limits (expires_at);

alter table public.security_rate_limits enable row level security;

revoke all on table public.security_rate_limits
  from public, anon, authenticated;
grant all on table public.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer default 1
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window integer := least(greatest(coalesce(p_window_seconds, 60), 1), 86400);
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 1000000);
  v_cost integer := least(greatest(coalesce(p_cost, 1), 1), 10000);
  v_window_start timestamptz;
  v_count integer;
begin
  if p_scope is null
     or p_scope !~ '^[a-z0-9:_-]{1,80}$'
     or p_key_hash is null
     or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit key';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / v_window) * v_window
  );

  insert into public.security_rate_limits (
    scope,
    key_hash,
    window_start,
    request_count,
    expires_at
  )
  values (
    p_scope,
    p_key_hash,
    v_window_start,
    v_cost,
    v_window_start + make_interval(secs => v_window * 2)
  )
  on conflict (scope, key_hash, window_start)
  do update set
    request_count = public.security_rate_limits.request_count + excluded.request_count,
    expires_at = excluded.expires_at
  returning request_count into v_count;

  if random() < 0.01 then
    delete from public.security_rate_limits where expires_at < v_now;
  end if;

  return query
  select
    v_count <= v_limit,
    greatest(v_limit - v_count, 0),
    v_window_start + make_interval(secs => v_window);
end;
$$;

revoke all on function public.consume_security_rate_limit(
  text,
  text,
  integer,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.consume_security_rate_limit(
  text,
  text,
  integer,
  integer,
  integer
) to service_role;
