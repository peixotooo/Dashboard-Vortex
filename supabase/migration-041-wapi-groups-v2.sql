-- Migration 041: WhatsApp Groups v2 — cached groups, presets, scheduled sends, dispatch logs

-- ============================================================
-- 1. wapi_groups — Cached group data from W-API
-- ============================================================

CREATE TABLE IF NOT EXISTS wapi_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'Sem nome',
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, group_jid)
);

CREATE INDEX idx_wapi_groups_ws ON wapi_groups(workspace_id);

ALTER TABLE wapi_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_groups"
  ON wapi_groups FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_groups"
  ON wapi_groups FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. wapi_group_presets — Named sets of groups
-- ============================================================

CREATE TABLE IF NOT EXISTS wapi_group_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_jids TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wapi_group_presets_ws ON wapi_group_presets(workspace_id);

ALTER TABLE wapi_group_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_group_presets"
  ON wapi_group_presets FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_group_presets"
  ON wapi_group_presets FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 3. wapi_group_dispatches — Top-level send jobs
-- ============================================================

CREATE TABLE IF NOT EXISTS wapi_group_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  media_url TEXT,
  file_name TEXT,
  file_extension TEXT,
  delay_seconds INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  target_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_groups INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wapi_group_dispatches_ws ON wapi_group_dispatches(workspace_id, created_at DESC);
CREATE INDEX idx_wapi_group_dispatches_status ON wapi_group_dispatches(status)
  WHERE status IN ('queued', 'scheduled', 'sending');

ALTER TABLE wapi_group_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_group_dispatches"
  ON wapi_group_dispatches FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_group_dispatches"
  ON wapi_group_dispatches FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 4. Alter wapi_group_messages — add dispatch_id FK
-- ============================================================

ALTER TABLE wapi_group_messages
  ADD COLUMN IF NOT EXISTS dispatch_id UUID REFERENCES wapi_group_dispatches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wapi_group_messages_dispatch ON wapi_group_messages(dispatch_id);
