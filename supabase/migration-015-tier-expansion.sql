-- Expand tier classification to include profitable, warning, critical
-- These new tiers cover ALL campaigns/creatives with spend > 0

ALTER TABLE saved_creatives DROP CONSTRAINT IF EXISTS saved_creatives_tier_check;
ALTER TABLE saved_creatives ADD CONSTRAINT saved_creatives_tier_check
  CHECK (tier IN ('champion', 'potential', 'scale', 'profitable', 'warning', 'critical'));

ALTER TABLE saved_campaigns DROP CONSTRAINT IF EXISTS saved_campaigns_tier_check;
ALTER TABLE saved_campaigns ADD CONSTRAINT saved_campaigns_tier_check
  CHECK (tier IN ('champion', 'potential', 'scale', 'profitable', 'warning', 'critical'));
