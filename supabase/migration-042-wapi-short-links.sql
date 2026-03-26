-- Migration 042: Short links for WhatsApp Groups with auto UTM

CREATE TABLE IF NOT EXISTS wapi_short_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  dispatch_id UUID REFERENCES wapi_group_dispatches(id) ON DELETE SET NULL,
  click_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wapi_short_links_code ON wapi_short_links(short_code);
CREATE INDEX idx_wapi_short_links_ws ON wapi_short_links(workspace_id, created_at DESC);

ALTER TABLE wapi_short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view wapi_short_links"
  ON wapi_short_links FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage wapi_short_links"
  ON wapi_short_links FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
