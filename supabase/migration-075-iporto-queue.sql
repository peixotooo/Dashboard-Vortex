-- supabase/migration-075-iporto-queue.sql
--
-- Fila pra disparos iPORTO em escala (10k+). iPORTO é transacional
-- (1 request/destinatário), então pra um disparo de 30k contatos a
-- abordagem síncrona da Vercel não cabe no timeout de 60-300s.
--
-- Arquitetura:
--   1. /drafts/[id]/dispatch (provider=iporto) → insere N rows em
--      email_template_iporto_envios com status='pending' e retorna
--      202 imediato. O usuário vê "processando" e pode acompanhar via
--      contadores em dispatches.recipients_sent / recipients_failed.
--   2. Cron /api/cron/iporto-dispatcher roda a cada minuto, faz claim
--      de até 1000 envios pendentes via SELECT ... FOR UPDATE SKIP
--      LOCKED, processa com concorrência 20 e atualiza status.
--   3. Webhook /api/webhooks/iporto recebe eventos por message_id e
--      atualiza tanto o envio individual quanto agrega stats no
--      dispatch.
--
-- Throughput: ~1000 envios/min por cron × 1 cron/min = 60k/h. Pra
-- escalar mais, agendar múltiplos paths no vercel.json (FOR UPDATE
-- SKIP LOCKED previne duplo processamento) ou adicionar self-recursion
-- no fim do cron.
--
-- Retries: erros transientes (5xx, 429) voltam pra status='pending'
-- com next_attempt_at = now + 2^attempts * 5s. Erros permanentes
-- (4xx exceto 429) viram 'failed' imediatamente. Após 5 tentativas
-- mesmo transient vira 'failed'.

create table if not exists email_template_iporto_envios (
  id bigserial primary key,
  dispatch_id uuid not null references email_template_dispatches(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  name text,
  -- Vars opcionais por destinatário pra interpolação no HTML
  -- (placeholders {{var}}).
  vars jsonb default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  iporto_message_id text,
  attempts int not null default 0,
  next_attempt_at timestamptz default now() not null,
  error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Index pra claim pelo cron (pega os mais antigos elegíveis primeiro).
create index if not exists iporto_envios_claim_idx
  on email_template_iporto_envios (next_attempt_at, id)
  where status = 'pending';

create index if not exists iporto_envios_dispatch_idx
  on email_template_iporto_envios (dispatch_id);

-- Lookup por message_id pro webhook.
create index if not exists iporto_envios_message_idx
  on email_template_iporto_envios (iporto_message_id)
  where iporto_message_id is not null;

-- Conteúdo da campanha persistido no dispatch — o cron renderiza por
-- envio interpolando vars, mas o template HTML é o mesmo.
alter table email_template_dispatches
  add column if not exists html_body text,
  add column if not exists subject text,
  add column if not exists from_email text,
  add column if not exists from_name text;

-- Atomic claim: marca status='processing' + attempts++ e devolve os rows
-- pro cron processar. FOR UPDATE SKIP LOCKED garante que múltiplos
-- crons concorrentes não duplicam.
create or replace function claim_iporto_envios(p_limit int)
returns setof email_template_iporto_envios
language sql
security definer
set search_path = public
as $$
  update email_template_iporto_envios e
  set status = 'processing',
      attempts = attempts + 1,
      updated_at = now()
  where e.id in (
    select id from email_template_iporto_envios
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at, id
    for update skip locked
    limit p_limit
  )
  returning *;
$$;

-- Helper pra recolocar um envio pra retry com backoff.
create or replace function requeue_iporto_envio(
  p_id bigint,
  p_error text,
  p_max_attempts int default 5
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
begin
  select attempts into v_attempts
  from email_template_iporto_envios
  where id = p_id;

  if v_attempts >= p_max_attempts then
    update email_template_iporto_envios
    set status = 'failed',
        error = p_error,
        updated_at = now()
    where id = p_id;
  else
    -- backoff exponencial: 5s, 10s, 20s, 40s, 80s
    update email_template_iporto_envios
    set status = 'pending',
        next_attempt_at = now() + (interval '5 seconds' * (2 ^ v_attempts)),
        error = p_error,
        updated_at = now()
    where id = p_id;
  end if;
end;
$$;
