-- Migration 048: Backfill ml_category_id from ml_enrichment JSONB
-- push-ml never stored ml_category_id, so cross-ref lookups in import-family failed

UPDATE hub_products
SET ml_category_id = ml_enrichment->>'category_id', updated_at = now()
WHERE ml_item_id IS NOT NULL
  AND ml_category_id IS NULL
  AND ml_enrichment->>'category_id' IS NOT NULL;
