-- Migration 027: CRM Webhook support
-- Adds new columns to crm_vendas for rich VNDA data,
-- webhook_token to vnda_connections, and webhook logs table.

-- 1. New columns in crm_vendas for rich order data
ALTER TABLE crm_vendas
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS source_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS birthdate DATE,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS installments INTEGER,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS shipping_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS delivery_days INTEGER,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS items JSONB,
  ADD COLUMN IF NOT EXISTS discounts JSONB;

-- 2. Unique index for dedup (only when source_order_id is present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_vendas_source_order
  ON crm_vendas (workspace_id, source, source_order_id)
  WHERE source_order_id IS NOT NULL;

-- 3. Webhook token on vnda_connections
ALTER TABLE vnda_connections
  ADD COLUMN IF NOT EXISTS webhook_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vnda_connections_webhook_token
  ON vnda_connections (webhook_token)
  WHERE webhook_token IS NOT NULL;

-- 4. Webhook logs table
CREATE TABLE IF NOT EXISTS vnda_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vnda_webhook_logs_workspace
  ON vnda_webhook_logs (workspace_id, created_at DESC);
