-- Migration 125: Checkout session rollups
--
-- Keeps checkout analytics cheap to query. Raw checkout_events remains the
-- append-only source, while the worker periodically condenses each checkout
-- session into one row for the dashboard overview.

CREATE TABLE IF NOT EXISTS checkout_session_rollups (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  consumer_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  purchased BOOLEAN NOT NULL DEFAULT false,
  last_step TEXT CHECK (last_step IN (
    'cart',
    'identification',
    'shipping',
    'payment',
    'confirmation',
    'unknown'
  )),
  last_field_key TEXT,
  payment_method TEXT CHECK (payment_method IN (
    'pix',
    'credit_card',
    'debit_card',
    'boleto',
    'other'
  )),
  shipping_method TEXT CHECK (shipping_method IN (
    'sedex',
    'pac',
    'pickup',
    'motoboy',
    'transportadora',
    'other'
  )),
  steps_seen JSONB NOT NULL DEFAULT '{}'::jsonb,
  fields_touched JSONB NOT NULL DEFAULT '{}'::jsonb,
  fields_completed JSONB NOT NULL DEFAULT '{}'::jsonb,
  fields_errored JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_codes JSONB NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_rollups_ws_first_seen
  ON checkout_session_rollups (workspace_id, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_rollups_ws_last_seen
  ON checkout_session_rollups (workspace_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_rollups_refreshed
  ON checkout_session_rollups (refreshed_at DESC);

ALTER TABLE checkout_session_rollups ENABLE ROW LEVEL SECURITY;

-- No client-side policies: server routes and the worker use service role.
