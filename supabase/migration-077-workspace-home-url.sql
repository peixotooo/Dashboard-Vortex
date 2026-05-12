-- supabase/migration-077-workspace-home-url.sql
--
-- home_url da marca, usado pra envelopar imagens "soltas" (logo,
-- hero decorativo) com <a href="${home_url}"> nos e-mails.
--
-- Decisão: a coluna fica em workspace_email_marketing (não em
-- workspaces) porque é configuração específica do canal de e-mail —
-- alguns workspaces podem ter o brand site em um domínio e enviar
-- e-mail de outro (raro, mas possível). Compartilhada entre Locaweb
-- e iPORTO; edição em qualquer das duas telas grava no mesmo campo.
--
-- Fallback (em código, não na DB):
--   1. workspace_email_marketing.home_url, se preenchido
--   2. derivar do domínio do default_sender_email
--      (ex: no-reply@bulking.com.br → https://bulking.com.br)
--   3. constante DEFAULT_HOME_URL em tracking.ts (último recurso)
alter table workspace_email_marketing
  add column if not exists home_url text;
