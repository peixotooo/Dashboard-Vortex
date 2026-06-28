-- Migration 124: Checkout micro-funnel events
--
-- Public storefront script records checkout friction without storing PII:
-- no field values, no CPF/email/card data, only normalized field keys,
-- checkout step, payment/shipping method category and error category.

CREATE TABLE IF NOT EXISTS checkout_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  consumer_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'checkout_started',
    'checkout_step_viewed',
    'checkout_field_started',
    'checkout_field_completed',
    'checkout_field_error',
    'checkout_shipping_calculated',
    'checkout_shipping_selected',
    'checkout_payment_method_selected',
    'checkout_payment_attempted',
    'checkout_purchase_completed',
    'checkout_abandon_snapshot'
  )),
  step TEXT CHECK (step IN (
    'cart',
    'identification',
    'shipping',
    'payment',
    'confirmation',
    'unknown'
  )),
  field_key TEXT,
  field_group TEXT CHECK (field_group IN (
    'contact',
    'address',
    'shipping',
    'payment',
    'coupon',
    'other'
  )),
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
  error_code TEXT,
  path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_events_ws_created
  ON checkout_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_events_ws_event_created
  ON checkout_events (workspace_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_events_ws_step_created
  ON checkout_events (workspace_id, step, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_events_ws_field_created
  ON checkout_events (workspace_id, field_key, created_at DESC)
  WHERE field_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_events_session
  ON checkout_events (workspace_id, session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkout_events_cleanup
  ON checkout_events (created_at);

ALTER TABLE checkout_events ENABLE ROW LEVEL SECURITY;

-- No client-side RLS policies: public writes go through /api/checkout-events
-- with API key validation and service role insert. Dashboard reads go through
-- authenticated server routes.
