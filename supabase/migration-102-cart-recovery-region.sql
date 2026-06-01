-- Migration 102: UF/regiao para personalizacao de recuperacao de carrinho

ALTER TABLE abandoned_carts
  ADD COLUMN IF NOT EXISTS customer_state TEXT,
  ADD COLUMN IF NOT EXISTS customer_region TEXT;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_region_open
  ON abandoned_carts (workspace_id, customer_region, status)
  WHERE status = 'open';
