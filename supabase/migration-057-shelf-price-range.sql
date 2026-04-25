-- Migration 057: Add price range columns to shelf_configs
-- Enables shelves that filter products by price band (e.g. "Ate R$ 100", "R$ 100-200", "R$ 200+")

ALTER TABLE shelf_configs ADD COLUMN IF NOT EXISTS price_min NUMERIC(12,2);
ALTER TABLE shelf_configs ADD COLUMN IF NOT EXISTS price_max NUMERIC(12,2);
