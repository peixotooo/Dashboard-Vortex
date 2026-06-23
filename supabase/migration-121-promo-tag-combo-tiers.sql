-- Optional PDP combo pricing table for promotional tags.
-- Shape:
-- {
--   "enabled": true,
--   "title": "Compre mais, pague menos",
--   "subtitle": "Desconto aplicado automaticamente no carrinho.",
--   "tiers": [{ "quantity": 2, "total": 149, "label": "2 por R$149" }]
-- }

ALTER TABLE public.promo_tag_configs
  ADD COLUMN IF NOT EXISTS combo_tiers jsonb NOT NULL
  DEFAULT '{"enabled":false,"title":"Compre mais, pague menos","subtitle":"","tiers":[]}'::jsonb;

COMMENT ON COLUMN public.promo_tag_configs.combo_tiers IS
  'Optional combo pricing table rendered near PDP promo tags.';
