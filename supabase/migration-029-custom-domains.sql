-- Migration 029: Custom domains for workspaces
-- Allows each workspace to configure a custom domain (e.g., dash.bulking.com.br)

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS custom_domain TEXT;

-- Unique index (partial — only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_custom_domain
  ON workspaces(custom_domain) WHERE custom_domain IS NOT NULL;
