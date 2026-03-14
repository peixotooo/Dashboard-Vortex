-- Migration 032: WhatsApp Business API integration
-- Tables for config, templates, campaigns, and message queue

-- ============================================================
-- 1. wa_config — WhatsApp credentials per workspace
-- ============================================================

CREATE TABLE IF NOT EXISTS wa_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  display_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE wa_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wa_config"
  ON wa_config FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wa_config"
  ON wa_config FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. wa_templates — Synced from Meta API
-- ============================================================

CREATE TABLE IF NOT EXISTS wa_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meta_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  category TEXT NOT NULL DEFAULT 'MARKETING',
  status TEXT NOT NULL DEFAULT 'APPROVED',
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wa_templates_ws ON wa_templates(workspace_id);
CREATE UNIQUE INDEX idx_wa_templates_ws_meta ON wa_templates(workspace_id, meta_id) WHERE meta_id IS NOT NULL;

ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wa_templates"
  ON wa_templates FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wa_templates"
  ON wa_templates FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 3. wa_campaigns — Campaign definitions
-- ============================================================

CREATE TABLE IF NOT EXISTS wa_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  segment_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  variable_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  total_messages INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  read_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wa_campaigns_ws ON wa_campaigns(workspace_id, created_at DESC);
CREATE INDEX idx_wa_campaigns_status ON wa_campaigns(status) WHERE status IN ('queued', 'sending');

ALTER TABLE wa_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wa_campaigns"
  ON wa_campaigns FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wa_campaigns"
  ON wa_campaigns FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 4. wa_messages — Message queue (individual sends)
-- ============================================================

CREATE TABLE IF NOT EXISTS wa_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  contact_name TEXT,
  variable_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  meta_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wa_messages_queue ON wa_messages(workspace_id, campaign_id, status);
CREATE INDEX idx_wa_messages_meta ON wa_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wa_messages"
  ON wa_messages FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wa_messages"
  ON wa_messages FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
