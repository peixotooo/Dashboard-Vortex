-- Migration 044: Enrich hub_products with full ML listing details
-- Adds ml_data JSONB column for storing extended Mercado Livre item data
-- (listing type, shipping, health score, visits, sold quantity, etc.)

ALTER TABLE hub_products
  ADD COLUMN IF NOT EXISTS ml_data JSONB DEFAULT NULL;

-- GIN index for querying inside ml_data
CREATE INDEX IF NOT EXISTS idx_hub_products_ml_data
  ON hub_products USING GIN (ml_data)
  WHERE ml_data IS NOT NULL;
