-- Migration 047: Fix linked flag for products published from Eccosys to ML
-- push-ml never set linked=true, so stock sync (which requires linked=true) never ran

UPDATE hub_products
SET linked = true, updated_at = now()
WHERE source = 'eccosys'
  AND ml_item_id IS NOT NULL
  AND linked = false;

-- Partial index for stock sync query performance
CREATE INDEX IF NOT EXISTS idx_hub_products_stock_sync
  ON hub_products(workspace_id)
  WHERE linked = true AND ml_item_id IS NOT NULL AND sync_status = 'synced' AND sob_demanda = false;
