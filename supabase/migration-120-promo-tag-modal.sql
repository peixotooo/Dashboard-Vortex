-- Migration 120: optional informational modal for promo tag badges.
-- Lets static badges act as clickable PDP/listing labels with a short
-- explanation, such as shipping SLA disclaimers.

ALTER TABLE public.promo_tag_configs
  ADD COLUMN IF NOT EXISTS modal_title TEXT,
  ADD COLUMN IF NOT EXISTS modal_body TEXT;
