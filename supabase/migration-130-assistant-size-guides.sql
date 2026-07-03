-- Migration 130: Tabelas de medidas do assistente, por MOLDE
--
-- As medidas reais (P: 74 cm comprimento / 52 cm tórax...) só existem no HTML
-- da PDP (popup guia-de-medidas) — não vêm na API v2. A vitrine está atrás de
-- Cloudflare, que bloqueia o fetch do datacenter da Vercel. Então um script
-- (scripts/assistant-sizeguide-sync.ts, rodado de IP confiável) extrai por
-- MOLDE (tag guia-de-medidas; ~55 moldes cobrem o catálogo) e grava aqui;
-- o runtime só lê. Escala: molde novo = re-rodar o sync.

CREATE TABLE IF NOT EXISTS assistant_size_guides (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  molde TEXT NOT NULL,
  guide TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, molde)
);

ALTER TABLE assistant_size_guides ENABLE ROW LEVEL SECURITY;

-- Leitura pelo dashboard; escrita só via service role (script/servidor).
CREATE POLICY "Members view assistant_size_guides" ON assistant_size_guides
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
