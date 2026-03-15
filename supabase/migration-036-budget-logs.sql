-- Budget adjustment logs — tracks every budget change to enforce cooldown
CREATE TABLE IF NOT EXISTS budget_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  old_budget INT NOT NULL,        -- in cents
  new_budget INT NOT NULL,        -- in cents
  change_pct NUMERIC(6,2),        -- e.g. 20.00 for +20%
  tier TEXT,                       -- tier at time of adjustment
  adjusted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_budget_logs_ws_campaign
  ON budget_logs(workspace_id, campaign_id, created_at DESC);

ALTER TABLE budget_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view budget_logs"
  ON budget_logs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage budget_logs"
  ON budget_logs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
