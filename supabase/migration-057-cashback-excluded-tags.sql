-- Migration 057: Cashback eligibility — exclude clients with specific VNDA tags
-- (e.g. "bulking-club" members, who already get other benefits)

ALTER TABLE cashback_config
  ADD COLUMN IF NOT EXISTS excluded_client_tags TEXT[] NOT NULL DEFAULT ARRAY['bulking-club'];

-- Backfill any existing rows just in case the default doesn't apply
UPDATE cashback_config
  SET excluded_client_tags = ARRAY['bulking-club']
  WHERE excluded_client_tags IS NULL OR cardinality(excluded_client_tags) = 0;
