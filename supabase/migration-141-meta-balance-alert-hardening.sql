-- Hardens Meta prepaid balance alerts with an atomic send claim, retry-safe
-- completion, and enough state to diagnose failures without reading cron logs.

alter table public.meta_balance_alerts
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists observed_level text not null default 'ok',
  add column if not exists daily_burn numeric,
  add column if not exists runway_hours numeric,
  add column if not exists last_checked_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists claim_level text,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists last_message_id text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

update public.meta_balance_alerts
set last_alert_level = 'ok'
where last_alert_level is null
   or last_alert_level not in ('ok', 'warn', 'critical');

alter table public.meta_balance_alerts
  alter column last_alert_level set default 'ok',
  alter column last_alert_level set not null;

alter table public.meta_balance_alerts
  drop constraint if exists meta_balance_alerts_last_alert_level_check,
  drop constraint if exists meta_balance_alerts_observed_level_check,
  drop constraint if exists meta_balance_alerts_claim_level_check;

alter table public.meta_balance_alerts
  add constraint meta_balance_alerts_last_alert_level_check
    check (last_alert_level in ('ok', 'warn', 'critical')),
  add constraint meta_balance_alerts_observed_level_check
    check (observed_level in ('ok', 'warn', 'critical')),
  add constraint meta_balance_alerts_claim_level_check
    check (claim_level is null or claim_level in ('warn', 'critical'));

create index if not exists idx_meta_balance_alerts_errors
  on public.meta_balance_alerts (last_error_at desc)
  where last_error_at is not null;

create or replace function public.claim_meta_balance_alert(
  p_account_id text,
  p_account_name text,
  p_workspace_id uuid,
  p_available numeric,
  p_daily_burn numeric,
  p_runway_hours numeric,
  p_observed_level text,
  p_recharge_margin numeric default 50,
  p_claim_ttl_seconds integer default 900
)
returns table (
  should_send boolean,
  alert_claim_token uuid,
  previous_alert_level text,
  recharged boolean,
  decision text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.meta_balance_alerts%rowtype;
  v_previous text;
  v_recharged boolean := false;
  v_claim_active boolean := false;
  v_should_send boolean := false;
  v_claim_token uuid := null;
  v_decision text := 'already_sent';
  v_now timestamptz := clock_timestamp();
begin
  if p_observed_level not in ('ok', 'warn', 'critical') then
    raise exception 'invalid observed alert level: %', p_observed_level;
  end if;
  if p_available is null or p_available < 0 then
    raise exception 'invalid available balance';
  end if;
  if p_daily_burn is null or p_daily_burn < 0 then
    raise exception 'invalid daily burn';
  end if;

  insert into public.meta_balance_alerts (
    account_id,
    account_name,
    workspace_id,
    last_available,
    last_alert_level,
    observed_level,
    daily_burn,
    runway_hours,
    last_checked_at,
    updated_at
  ) values (
    p_account_id,
    p_account_name,
    p_workspace_id,
    p_available,
    'ok',
    p_observed_level,
    p_daily_burn,
    p_runway_hours,
    v_now,
    v_now
  )
  on conflict (account_id) do nothing;

  select *
  into v_state
  from public.meta_balance_alerts
  where account_id = p_account_id
  for update;

  v_previous := coalesce(v_state.last_alert_level, 'ok');
  v_recharged :=
    v_state.last_checked_at is not null
    and v_state.last_available is not null
    and p_available > v_state.last_available + greatest(0, p_recharge_margin);
  v_claim_active :=
    v_state.claim_token is not null
    and v_state.claim_expires_at is not null
    and v_state.claim_expires_at > v_now;

  if p_observed_level = 'ok' or v_recharged then
    v_previous := 'ok';
    v_decision := case when v_recharged then 'recharged' else 'healthy' end;
    v_claim_active := false;
  elsif (
    case p_observed_level when 'critical' then 2 when 'warn' then 1 else 0 end
    > case v_previous when 'critical' then 2 when 'warn' then 1 else 0 end
  ) then
    if v_claim_active then
      v_decision := 'in_flight';
    else
      v_should_send := true;
      v_claim_token := gen_random_uuid();
      v_decision := 'claimed';
    end if;
  end if;

  update public.meta_balance_alerts
  set account_name = p_account_name,
      workspace_id = p_workspace_id,
      last_available = p_available,
      last_alert_level = v_previous,
      observed_level = p_observed_level,
      daily_burn = p_daily_burn,
      runway_hours = p_runway_hours,
      last_checked_at = v_now,
      claim_token = case
        when v_should_send then v_claim_token
        when v_claim_active then v_state.claim_token
        else null
      end,
      claim_level = case
        when v_should_send then p_observed_level
        when v_claim_active then v_state.claim_level
        else null
      end,
      claim_expires_at = case
        when v_should_send then v_now + make_interval(secs => greatest(60, p_claim_ttl_seconds))
        when v_claim_active then v_state.claim_expires_at
        else null
      end,
      last_error = null,
      last_error_at = null,
      updated_at = v_now
  where account_id = p_account_id;

  return query
  select v_should_send, v_claim_token, v_previous, v_recharged, v_decision;
end;
$$;

create or replace function public.complete_meta_balance_alert(
  p_account_id text,
  p_claim_token uuid,
  p_success boolean,
  p_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed boolean := false;
begin
  update public.meta_balance_alerts
  set last_alert_level = case
        when p_success then claim_level
        else last_alert_level
      end,
      last_alert_at = case when p_success then clock_timestamp() else last_alert_at end,
      last_message_id = case when p_success then p_message_id else last_message_id end,
      last_error = case
        when p_success then null
        else left(coalesce(nullif(p_error, ''), 'send_failed'), 1000)
      end,
      last_error_at = case when p_success then null else clock_timestamp() end,
      claim_token = null,
      claim_level = null,
      claim_expires_at = null,
      updated_at = clock_timestamp()
  where account_id = p_account_id
    and claim_token = p_claim_token
  returning true into v_completed;

  return coalesce(v_completed, false);
end;
$$;

create or replace function public.record_meta_balance_alert_error(
  p_account_id text,
  p_account_name text,
  p_workspace_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.meta_balance_alerts (
    account_id,
    account_name,
    workspace_id,
    last_alert_level,
    observed_level,
    last_error,
    last_error_at,
    updated_at
  ) values (
    p_account_id,
    p_account_name,
    p_workspace_id,
    'ok',
    'ok',
    left(coalesce(nullif(p_error, ''), 'unknown_error'), 1000),
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (account_id) do update
  set account_name = excluded.account_name,
      workspace_id = excluded.workspace_id,
      last_error = excluded.last_error,
      last_error_at = excluded.last_error_at,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.claim_meta_balance_alert(
  text, text, uuid, numeric, numeric, numeric, text, numeric, integer
) from public, anon, authenticated;
revoke all on function public.complete_meta_balance_alert(
  text, uuid, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.record_meta_balance_alert_error(
  text, text, uuid, text
) from public, anon, authenticated;

grant execute on function public.claim_meta_balance_alert(
  text, text, uuid, numeric, numeric, numeric, text, numeric, integer
) to service_role;
grant execute on function public.complete_meta_balance_alert(
  text, uuid, boolean, text, text
) to service_role;
grant execute on function public.record_meta_balance_alert_error(
  text, text, uuid, text
) to service_role;
