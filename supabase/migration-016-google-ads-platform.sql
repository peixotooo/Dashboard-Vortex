-- Migration 016: Add platform column for multi-platform support (Meta + Google Ads)
-- Allows saved_campaigns and saved_creatives to store data from both platforms

-- Add platform column with default 'meta' for existing rows
ALTER TABLE saved_campaigns ADD COLUMN IF NOT EXISTS platform text DEFAULT 'meta';
ALTER TABLE saved_campaigns ADD CONSTRAINT saved_campaigns_platform_check
  CHECK (platform IN ('meta', 'google'));

ALTER TABLE saved_creatives ADD COLUMN IF NOT EXISTS platform text DEFAULT 'meta';
ALTER TABLE saved_creatives ADD CONSTRAINT saved_creatives_platform_check
  CHECK (platform IN ('meta', 'google'));

-- Drop old unique constraints (workspace_id, campaign_id/ad_id)
-- and recreate with platform included
ALTER TABLE saved_campaigns DROP CONSTRAINT IF EXISTS saved_campaigns_workspace_id_campaign_id_key;
ALTER TABLE saved_campaigns ADD CONSTRAINT saved_campaigns_workspace_platform_campaign
  UNIQUE (workspace_id, platform, campaign_id);

ALTER TABLE saved_creatives DROP CONSTRAINT IF EXISTS saved_creatives_workspace_id_ad_id_key;
ALTER TABLE saved_creatives ADD CONSTRAINT saved_creatives_workspace_platform_ad
  UNIQUE (workspace_id, platform, ad_id);

-- Indexes for platform filtering
CREATE INDEX IF NOT EXISTS idx_saved_campaigns_platform ON saved_campaigns(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_saved_creatives_platform ON saved_creatives(workspace_id, platform);
