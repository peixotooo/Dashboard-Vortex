-- Migration 090: vnda_client_id em abandoned_carts
-- Necessário pra enrichment via GET /api/v2/clients/{id} — o payload do
-- webhook de carrinho abandonado NÃO traz nome do cliente, só email e
-- client_id. O cron busca o nome via API antes de disparar mensagens.

ALTER TABLE abandoned_carts
  ADD COLUMN IF NOT EXISTS vnda_client_id INTEGER,
  -- Marca quando tentamos enrichment pra evitar retentar infinitamente
  -- carts cujo client_id retorna 404 / 4xx na VNDA.
  ADD COLUMN IF NOT EXISTS enrichment_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_client_id
  ON abandoned_carts (workspace_id, vnda_client_id)
  WHERE vnda_client_id IS NOT NULL;
