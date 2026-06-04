-- Migration 108: email suppression list for unsubscribe / one-click unsubscribe.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'unsubscribe',
  source TEXT NOT NULL DEFAULT 'email',
  notes TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_ws_email
  ON email_suppressions(workspace_id, email);

INSERT INTO email_suppressions (workspace_id, email, reason, source, user_agent, created_at)
SELECT DISTINCT ON (workspace_id, lower(payload->>'email'))
  workspace_id,
  lower(payload->>'email') AS email,
  COALESCE(payload->>'reason', 'unsubscribe') AS reason,
  COALESCE(payload->>'source', 'email') AS source,
  payload->>'user_agent' AS user_agent,
  created_at
FROM email_template_audit
WHERE event = 'email_unsubscribed'
  AND payload ? 'email'
  AND nullif(trim(payload->>'email'), '') IS NOT NULL
ON CONFLICT (workspace_id, email) DO NOTHING;
