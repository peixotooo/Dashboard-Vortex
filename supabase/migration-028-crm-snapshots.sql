-- Migration 028: CRM RFM Snapshots
-- Pre-computed RFM data stored per workspace to avoid recomputing on every page load.
-- Snapshot is regenerated on CSV import, webhook ingest, or manual trigger.

-- 1. Snapshot table (one row per workspace)
CREATE TABLE IF NOT EXISTS crm_rfm_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Pre-computed RFM data
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  distributions JSONB NOT NULL DEFAULT '{}'::jsonb,
  behavioral JSONB NOT NULL DEFAULT '{}'::jsonb,
  customers JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Pre-computed cohort data
  cohort_metrics JSONB,
  cohort_monthly JSONB,

  row_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT crm_rfm_snapshots_workspace_unique UNIQUE(workspace_id)
);

-- 2. RLS
ALTER TABLE crm_rfm_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_rfm_snapshots_select"
  ON crm_rfm_snapshots FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "crm_rfm_snapshots_insert"
  ON crm_rfm_snapshots FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "crm_rfm_snapshots_update"
  ON crm_rfm_snapshots FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "crm_rfm_snapshots_delete"
  ON crm_rfm_snapshots FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_crm_rfm_snapshots_ws
  ON crm_rfm_snapshots(workspace_id);

-- 4. Performance indexes on crm_vendas
CREATE INDEX IF NOT EXISTS idx_crm_vendas_ws_date
  ON crm_vendas(workspace_id, data_compra DESC);

CREATE INDEX IF NOT EXISTS idx_crm_vendas_ws_email
  ON crm_vendas(workspace_id, email);

-- 5. Performance index on export logs
CREATE INDEX IF NOT EXISTS idx_crm_export_logs_ws_date
  ON crm_export_logs(workspace_id, created_at DESC);
