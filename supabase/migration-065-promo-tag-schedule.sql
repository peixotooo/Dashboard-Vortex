-- Migration 065: schedule window for promo tag rules.
-- Lets a rule auto-activate / auto-expire on configured timestamps without
-- needing manual enabled toggling. Useful for "Black Friday weekend",
-- "dia do frete grátis", etc.
--
-- Both columns are nullable: a rule with both null is always-on (current
-- behaviour). Either bound alone is honored too.

ALTER TABLE promo_tag_configs
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_promo_tags_schedule
  ON promo_tag_configs(workspace_id, starts_at, ends_at)
  WHERE enabled = true;
