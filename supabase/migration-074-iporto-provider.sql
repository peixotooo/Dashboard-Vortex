-- supabase/migration-074-iporto-provider.sql
--
-- Adiciona iPORTO como provider alternativo de e-mail marketing
-- (Locaweb continua sendo o padrão). Cada workspace pode escolher qual
-- usar em Configurações.
--
-- Decisões:
--   1. provider é coluna texto em workspace_email_marketing (default
--      'locaweb' pra não quebrar nada). Valor controla qual cliente
--      o dispatch-core usa.
--   2. iPORTO usa JWT Bearer token (não X-Auth-Token). API de envio é
--      transacional (um destinatário por request), diferente da Locaweb
--      que faz fan-out via list_ids. As credenciais vivem na mesma
--      tabela com prefix iporto_.
--   3. email_template_dispatches ganha provider + iporto_message_id +
--      iporto_message_ids (array, pra fan-out per-recipient). Locaweb
--      continua usando locaweb_message_id; iPORTO usa um message_id
--      por destinatário.

-- Provider + credenciais iPORTO em workspace_email_marketing.
alter table workspace_email_marketing
  add column if not exists provider text not null default 'locaweb'
    check (provider in ('locaweb', 'iporto')),
  add column if not exists iporto_base_url text default 'https://api.iporto.com.br/api/panel/application',
  add column if not exists iporto_token text,
  add column if not exists iporto_webhook_secret text;

-- Provider + tracking iPORTO em email_template_dispatches.
alter table email_template_dispatches
  add column if not exists provider text not null default 'locaweb'
    check (provider in ('locaweb', 'iporto')),
  add column if not exists iporto_message_ids text[] default '{}'::text[],
  add column if not exists recipients_total int default 0,
  add column if not exists recipients_sent int default 0,
  add column if not exists recipients_failed int default 0;

-- Permite locaweb_message_id ser null quando provider='iporto'. A coluna
-- ainda existe e segue sendo PK externo pra dispatches da Locaweb; iPORTO
-- usa iporto_message_ids.
alter table email_template_dispatches
  alter column locaweb_message_id drop not null;

-- Índice pra lookups por message_id da iPORTO (vindo do webhook).
create index if not exists email_template_dispatches_iporto_msgs_idx
  on email_template_dispatches using gin (iporto_message_ids);
