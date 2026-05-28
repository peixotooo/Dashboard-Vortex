-- Migration 098: customer_gender_inference
--
-- Inferência de gênero dos clientes a partir de nome (preferencial)
-- ou local-part do email, ancorada no Censo IBGE 2010 + heurística
-- de sufixo PT-BR como fallback. Não temos campo de sexo no CRM,
-- e várias frentes de comunicação (campanha WA, email, push) precisam
-- segmentar por gênero — esta tabela é o "source of truth" dessa
-- inferência por workspace.
--
-- Chave de junção: (workspace_id, email). Email é o identificador
-- de cliente em todo o CRM (crm_vendas.email, crm_rfm_snapshots.
-- customers[].email), então não criamos FK rígida — a inferência
-- pode existir pra emails ainda não materializados num snapshot.
--
-- A confiança é a moeda principal pra segmentação. Campanhas
-- "somente mulheres" devem filtrar por confidence IN ('high','medium')
-- — 'low' inclui heurística de sufixo e match via email, que tem
-- ruído maior. 'unknown' nunca deve entrar em segmento direcionado.

CREATE TABLE IF NOT EXISTS customer_gender_inference (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  inferred_gender TEXT NOT NULL CHECK (inferred_gender IN ('female','male','unknown')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low','unknown')),
  source TEXT NOT NULL CHECK (source IN ('name_ibge','email_ibge','name_suffix_rule','none','manual')),
  matched_name TEXT,
  female_ratio NUMERIC(4,3),
  inferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_gender_inference_ws_email_uk UNIQUE (workspace_id, email)
);

-- Índice composto pro caso de uso principal: "me dá todos os emails
-- de mulheres com confidence alta/média deste workspace pra montar
-- um segment_filter de WA campaign".
CREATE INDEX IF NOT EXISTS idx_cgi_segment
  ON customer_gender_inference (workspace_id, inferred_gender, confidence);

ALTER TABLE customer_gender_inference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view customer_gender_inference"
  ON customer_gender_inference FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage customer_gender_inference"
  ON customer_gender_inference FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
