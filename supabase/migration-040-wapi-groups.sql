-- Migration 040: W-API WhatsApp Groups integration
-- Tables for W-API credentials and group message logs

-- ============================================================
-- 1. wapi_config — W-API credentials per workspace
-- ============================================================

CREATE TABLE IF NOT EXISTS wapi_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  token TEXT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE wapi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_config"
  ON wapi_config FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_config"
  ON wapi_config FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. wapi_group_messages — Log of messages sent to groups
-- ============================================================

CREATE TABLE IF NOT EXISTS wapi_group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  media_url TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wapi_group_messages_ws ON wapi_group_messages(workspace_id, created_at DESC);

ALTER TABLE wapi_group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_group_messages"
  ON wapi_group_messages FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_group_messages"
  ON wapi_group_messages FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
