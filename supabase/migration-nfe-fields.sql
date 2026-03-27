-- Add NFe-related fields to hub_orders
ALTER TABLE hub_orders ADD COLUMN IF NOT EXISTS ecc_nfe_chave VARCHAR(50);
ALTER TABLE hub_orders ADD COLUMN IF NOT EXISTS ecc_data_faturamento DATE;
ALTER TABLE hub_orders ADD COLUMN IF NOT EXISTS ml_pack_id BIGINT;
ALTER TABLE hub_orders ADD COLUMN IF NOT EXISTS nfe_xml_sent_at TIMESTAMPTZ;
