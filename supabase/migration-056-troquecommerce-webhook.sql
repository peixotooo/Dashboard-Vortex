-- Migration 056: Troquecommerce webhook integration
-- Adds webhook_token to troquecommerce_config so Troquecommerce can push
-- exchange/return events directly instead of us polling.

ALTER TABLE troquecommerce_config
  ADD COLUMN IF NOT EXISTS webhook_token UUID UNIQUE DEFAULT gen_random_uuid();

-- Backfill UUIDs for existing rows
UPDATE troquecommerce_config SET webhook_token = gen_random_uuid() WHERE webhook_token IS NULL;

-- Webhook audit log (status + source payload + matched cashback id)
CREATE TABLE IF NOT EXISTS troquecommerce_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id TEXT,                      -- Troquecommerce order uuid
  ecommerce_number TEXT,                 -- VNDA order code
  reverse_type TEXT,                     -- Troca | Devolução
  status TEXT NOT NULL,                  -- received | processed | duplicate | error | no_match
  cashback_id UUID REFERENCES cashback_transactions(id) ON DELETE SET NULL,
  amount_deducted NUMERIC(10,2),
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_troque_logs_ws ON troquecommerce_webhook_logs(workspace_id, created_at DESC);
CREATE UNIQUE INDEX idx_troque_logs_external ON troquecommerce_webhook_logs(workspace_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE troquecommerce_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view troquecommerce_webhook_logs"
  ON troquecommerce_webhook_logs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage troquecommerce_webhook_logs"
  ON troquecommerce_webhook_logs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
