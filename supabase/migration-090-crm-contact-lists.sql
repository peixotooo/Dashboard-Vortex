-- supabase/migration-090-crm-contact-lists.sql
--
-- crm_contact_lists — listas personalizadas de contatos uploadadas via
-- CSV pelo usuário no CRM. Diferente de:
--   - crm_rfm_snapshots.segments → segmentos derivados das vendas
--   - email_template_audiences → específico do Locaweb
--
-- Esta tabela é o "source of truth" pra listas manuais que servem
-- ambos os canais (WhatsApp + Email). Cada contato pode ter telefone
-- e/ou email — a integração filtra pelo que precisa.
--
-- contacts é jsonb: [{ phone?: string, email?: string, name?: string }]
-- Mantemos como jsonb (não tabela separada) pelo mesmo motivo de
-- email_template_audiences: listas de 10k+ cabem folgadamente.

CREATE TABLE IF NOT EXISTS crm_contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_count INT NOT NULL DEFAULT 0,
  phone_count INT NOT NULL DEFAULT 0,
  email_count INT NOT NULL DEFAULT 0,
  -- Se promovido pro Locaweb, guardamos o list_id pra reuso no email.
  locaweb_list_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_lists_ws
  ON crm_contact_lists (workspace_id, created_at DESC);

ALTER TABLE crm_contact_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view crm_contact_lists"
  ON crm_contact_lists FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage crm_contact_lists"
  ON crm_contact_lists FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
