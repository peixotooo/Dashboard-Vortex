-- Migration 059: Product page benefits block
-- Renders below the buy button on product pages when enabled.
-- Each benefit: { icon, title, link_label?, modal_title?, modal_body? }

ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS show_product_benefits BOOLEAN DEFAULT false;
ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS product_benefits JSONB DEFAULT '[]'::jsonb;
ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS product_benefits_title TEXT DEFAULT 'Nossos benefícios';
ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS product_benefits_anchor TEXT;
