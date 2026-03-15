-- Expand budget_logs with optimization context
ALTER TABLE budget_logs
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'dashboard',
  ADD COLUMN IF NOT EXISTS spend_at_time INT,
  ADD COLUMN IF NOT EXISTS roas_at_time NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS revenue_at_time INT,
  ADD COLUMN IF NOT EXISTS was_smart BOOLEAN,
  ADD COLUMN IF NOT EXISTS risk_level TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_budget INT;

-- Aggregated optimization scores per workspace
CREATE TABLE IF NOT EXISTS budget_optimization_scores (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  total_changes INT DEFAULT 0,
  smart_changes INT DEFAULT 0,
  dashboard_changes INT DEFAULT 0,
  external_changes INT DEFAULT 0,
  missed_opportunities INT DEFAULT 0,
  wasted_spend INT DEFAULT 0,
  score NUMERIC(5,2) DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE budget_optimization_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view optimization_scores"
  ON budget_optimization_scores FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage optimization_scores"
  ON budget_optimization_scores FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
