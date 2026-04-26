-- Migration 061: extend promo_tag_configs with dynamic badge types
-- - 'static': original literal badge_text
-- - 'cashback': renders cashback amount based on product price + cashback_config %
-- - 'viewers': renders fluctuating live-viewers count per product

ALTER TABLE promo_tag_configs
  ADD COLUMN IF NOT EXISTS badge_type TEXT NOT NULL DEFAULT 'static'
    CHECK (badge_type IN ('static', 'cashback', 'viewers')),
  ADD COLUMN IF NOT EXISTS badge_placement TEXT NOT NULL DEFAULT 'auto'
    CHECK (badge_placement IN ('auto', 'pdp_price', 'pdp_above_buy', 'card_overlay')),
  ADD COLUMN IF NOT EXISTS viewers_min INT DEFAULT 6 CHECK (viewers_min >= 1),
  ADD COLUMN IF NOT EXISTS viewers_max INT DEFAULT 42 CHECK (viewers_max >= 1);
