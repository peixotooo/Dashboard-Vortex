-- supabase/migration-078-email-audiences.sql
--
-- email_template_audiences: storage local de audiências (listas de
-- e-mail) criadas pelo CRM. Locaweb tem uma API pra IMPORTAR contatos
-- numa lista (POST /contact_imports) mas NÃO expõe GET pra ler de
-- volta os contatos da lista (404 "Página não encontrada"). Sem isso,
-- o dispatch via iPORTO (que precisa de recipients[] por email) não
-- consegue resolver list_ids de volta em e-mails.
--
-- Fix: ao criar uma lista pelo CRM (bulk-import), persistimos os
-- contatos aqui também. Locaweb continua sendo o canal de envio
-- (quando provider=locaweb) mas a "fonte da verdade" pra leitura de
-- audiência fica em casa.
--
-- Lookup: workspace_id + locaweb_list_id é único; o dispatch resolve
-- list_ids do payload contra esse índice.

create table if not exists email_template_audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- ID da lista correspondente na Locaweb. Pode ser null em audiências
  -- "iPORTO-only" no futuro (ainda não criamos esse caminho).
  locaweb_list_id text,
  name text not null,
  -- Array de { email, name? }. Mantemos como jsonb pra evitar uma
  -- segunda tabela de N rows por audiência. 10k contatos cabem
  -- folgadamente (cada row ~50-100 bytes).
  contacts jsonb not null default '[]'::jsonb,
  total_count int not null default 0,
  -- 'crm' (CRM page → bulk-import), 'segment' (RFM cluster materializado),
  -- 'manual' (futuro).
  source text not null default 'crm' check (source in ('crm', 'segment', 'manual')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists email_template_audiences_workspace_idx
  on email_template_audiences (workspace_id, created_at desc);

-- Lookup principal: dispatch resolve list_ids contra esse índice.
create unique index if not exists email_template_audiences_locaweb_idx
  on email_template_audiences (workspace_id, locaweb_list_id)
  where locaweb_list_id is not null;
