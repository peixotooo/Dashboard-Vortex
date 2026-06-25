-- Migration 123: widen Eccosys ID columns from INT (int4) to BIGINT (int8).
--
-- Eccosys order IDs have crossed the int4 ceiling (2,147,483,647). Example:
-- pedido 2,149,250,189. With ecc_pedido_id as INT, pushOrderToEccosys creates
-- the Eccosys order but the follow-up UPDATE fails ("out of range for type
-- integer"), leaving hub_orders stuck at sync_status='pending' / ecc_pedido_id
-- NULL — which invites a duplicate re-import.
--
-- hub_products.ecc_id is already at ~2,120,816,381 (≈26M below the ceiling),
-- so ecc_id / ecc_pai_id / template_ecc_id would overflow next. Widen all.
-- INT -> BIGINT is a safe, lossless widening.

ALTER TABLE hub_orders        ALTER COLUMN ecc_pedido_id   TYPE BIGINT;
ALTER TABLE hub_products      ALTER COLUMN ecc_id          TYPE BIGINT;
ALTER TABLE hub_products      ALTER COLUMN ecc_pai_id      TYPE BIGINT;
ALTER TABLE product_collections ALTER COLUMN template_ecc_id TYPE BIGINT;

-- One-time backfill: order 2000017077581936 was imported to Eccosys pedido
-- 2149250189 (> int4 max) so the id failed to persist. Now that the column is
-- BIGINT, restore it. Idempotent (only fills if still NULL).
UPDATE hub_orders
SET ecc_pedido_id = 2149250189
WHERE workspace_id = '36f37e88-a9c7-4ed7-89b9-45e62b8bba04'
  AND ml_order_id = 2000017077581936
  AND ecc_pedido_id IS NULL;
