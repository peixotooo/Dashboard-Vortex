-- Migration 060: Inline gift bar mode for product pages
-- When true, the bar renders inline below the buy button on PDPs (using product_benefits_anchor)
-- and does NOT render at top/bottom or on non-product pages.

ALTER TABLE gift_bar_configs ADD COLUMN IF NOT EXISTS pdp_inline BOOLEAN DEFAULT false;
