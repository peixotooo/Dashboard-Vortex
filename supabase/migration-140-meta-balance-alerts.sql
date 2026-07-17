-- Estado de debounce dos alertas de saldo pré-pago das contas de anúncio Meta
-- (job do worker: /api/cron/meta-balance-alert). Só o service-role lê/escreve.
create table if not exists public.meta_balance_alerts (
  account_id text primary key,
  account_name text,
  last_available numeric,
  last_alert_level text, -- 'ok' | 'warn' | 'critical'
  last_alert_at timestamptz,
  updated_at timestamptz default now()
);

alter table public.meta_balance_alerts enable row level security;
-- Sem policies públicas: apenas o worker/cron (service-role) acessa.
