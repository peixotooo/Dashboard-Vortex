-- migration-046: Add ml_enrichment JSONB for pre-publication ML data
-- ml_enrichment stores data prepared FOR ML publishing (category, brand, attributes, etc.)
-- Separate from ml_data which stores data observed FROM ML (visits, health, etc.)

ALTER TABLE hub_products
  ADD COLUMN IF NOT EXISTS ml_enrichment JSONB DEFAULT NULL;
