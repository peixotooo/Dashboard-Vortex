-- Migration 119: TikTok Ads OAuth credentials (per workspace) + platform CHECK extension
--
-- Mirrors ml_credentials (migration-043) but for the TikTok Marketing API. Key
-- difference: the TikTok advertiser access token is DURABLE — it does not carry a
-- refresh_token and does not expire until revoked in TikTok Business Center. So
-- there is NO refresh_token / expires_at column and no refresh job.
--
-- The OAuth authorization returns several advertiser_ids at once, stored as a jsonb
-- array. Single connection per workspace (single org) → UNIQUE(workspace_id).
--
-- NOTE: like migrations 105/106/109-114/117/118 in this repo, apply MANUALLY in the
-- Supabase SQL editor.

CREATE TABLE IF NOT EXISTS tiktok_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  advertiser_ids JSONB NOT NULL DEFAULT '[]',   -- array of authorized advertiser_id strings
  access_token TEXT NOT NULL,                    -- AES-256-GCM via src/lib/encryption.ts
  scope JSONB DEFAULT '[]',                       -- granted scope ints from the token response
  tiktok_app_id TEXT,                            -- which app authorized (for multi-app later)
  label VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_credentials_ws ON tiktok_credentials(workspace_id);

ALTER TABLE tiktok_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view tiktok_credentials" ON tiktok_credentials;
CREATE POLICY "Members can view tiktok_credentials"
  ON tiktok_credentials FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage tiktok_credentials" ON tiktok_credentials;
CREATE POLICY "Admins can manage tiktok_credentials"
  ON tiktok_credentials FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Extend the migration-016 platform CHECK so saved_campaigns/saved_creatives accept 'tiktok'.
-- Self-healing: ensure the `platform` column exists first. In this production DB the
-- saved_creatives part of migration-016 never fully applied (the column is missing),
-- so add it here (idempotent) before re-creating the CHECK.
ALTER TABLE saved_campaigns ADD COLUMN IF NOT EXISTS platform text DEFAULT 'meta';
ALTER TABLE saved_campaigns DROP CONSTRAINT IF EXISTS saved_campaigns_platform_check;
ALTER TABLE saved_campaigns ADD CONSTRAINT saved_campaigns_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok'));

ALTER TABLE saved_creatives ADD COLUMN IF NOT EXISTS platform text DEFAULT 'meta';
ALTER TABLE saved_creatives DROP CONSTRAINT IF EXISTS saved_creatives_platform_check;
ALTER TABLE saved_creatives ADD CONSTRAINT saved_creatives_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok'));
