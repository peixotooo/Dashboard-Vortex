-- Migration 134: widen collection_items.ecc_product_id from INT (int4) to BIGINT.
--
-- Follow-up to migration 123, which widened the sibling Eccosys-ID columns
-- (hub_orders.ecc_pedido_id, hub_products.ecc_id/ecc_pai_id,
-- product_collections.template_ecc_id) but MISSED this one.
--
-- Eccosys product IDs have now crossed the int4 ceiling (2,147,483,647).
-- In the pre-cadastro submit flow (src/app/api/pre-cadastro/submit/route.ts),
-- Eccosys creates the product and returns an id > int4; the follow-up UPDATE
-- of collection_items.ecc_product_id then fails ("value out of range for type
-- integer"). Because that update's error was never checked, the endpoint still
-- reported submitted:N / errors:0, leaving the item stuck at status='ready'
-- with ecc_product_id NULL and no codigo — and inviting a duplicate re-submit
-- (exactly the failure mode migration 123 documents for orders).
--
-- INT -> BIGINT is a safe, lossless widening.

ALTER TABLE collection_items ALTER COLUMN ecc_product_id TYPE BIGINT;
