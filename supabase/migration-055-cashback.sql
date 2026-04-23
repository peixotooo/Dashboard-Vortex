-- Migration 055: Cashback Bulking
-- Tables for config, transactions, events, reminder templates, SMTP (Locaweb).
-- Extends vnda_connections with enable_cashback flag.

-- ============================================================
-- 1. cashback_config — 1 row per workspace, editable in UI
-- ============================================================

CREATE TABLE IF NOT EXISTS cashback_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Calculation
  percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (percentage >= 0 AND percentage <= 100),
  calculate_over TEXT NOT NULL DEFAULT 'net' CHECK (calculate_over IN ('net', 'subtotal', 'total')),

  -- Lifecycle timing
  deposit_delay_days INT NOT NULL DEFAULT 15 CHECK (deposit_delay_days >= 0),
  validity_days INT NOT NULL DEFAULT 30 CHECK (validity_days > 0),
  reminder_1_day INT NOT NULL DEFAULT 15,
  reminder_2_day INT NOT NULL DEFAULT 25,
  reminder_3_day INT NOT NULL DEFAULT 29,
  reactivation_days INT NOT NULL DEFAULT 15 CHECK (reactivation_days > 0),
  reactivation_reminder_day INT NOT NULL DEFAULT 13,

  -- Channel gates
  whatsapp_min_value NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  email_min_value NUMERIC(10,2) NOT NULL DEFAULT 5.00,

  -- Channel mode master toggle (UI-driven)
  channel_mode TEXT NOT NULL DEFAULT 'both' CHECK (channel_mode IN ('whatsapp_only', 'email_only', 'both', 'custom')),

  -- Feature flags
  enable_whatsapp BOOLEAN NOT NULL DEFAULT true,
  enable_email BOOLEAN NOT NULL DEFAULT true,
  enable_deposit BOOLEAN NOT NULL DEFAULT true,
  enable_refund BOOLEAN NOT NULL DEFAULT true,
  enable_troquecommerce BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id)
);

ALTER TABLE cashback_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view cashback_config"
  ON cashback_config FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage cashback_config"
  ON cashback_config FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. cashback_transactions — 1 per order that generates cashback
-- ============================================================

CREATE TABLE IF NOT EXISTS cashback_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Order / customer identity
  source_order_id TEXT NOT NULL,
  numero_pedido TEXT,
  email TEXT NOT NULL,
  nome_cliente TEXT,
  telefone TEXT,

  -- Amounts
  valor_pedido NUMERIC(10,2) NOT NULL,
  valor_frete NUMERIC(10,2) NOT NULL DEFAULT 0,
  valor_cashback NUMERIC(10,2) NOT NULL,

  -- State
  status TEXT NOT NULL DEFAULT 'AGUARDANDO_DEPOSITO' CHECK (status IN (
    'AGUARDANDO_DEPOSITO', 'ATIVO', 'USADO', 'EXPIRADO', 'CANCELADO', 'REATIVADO'
  )),
  reativado BOOLEAN NOT NULL DEFAULT false,
  troca_abatida BOOLEAN NOT NULL DEFAULT false,
  valor_troca_abatida NUMERIC(10,2),

  -- Lifecycle timestamps
  confirmado_em TIMESTAMPTZ NOT NULL,
  depositado_em TIMESTAMPTZ,
  expira_em TIMESTAMPTZ NOT NULL,
  estornado_em TIMESTAMPTZ,
  usado_em TIMESTAMPTZ,

  -- Reminder idempotency
  lembrete1_enviado_em TIMESTAMPTZ,
  lembrete2_enviado_em TIMESTAMPTZ,
  lembrete3_enviado_em TIMESTAMPTZ,
  reativacao_enviado_em TIMESTAMPTZ,
  reativacao_lembrete2 TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id, source_order_id)
);

CREATE INDEX idx_cashback_tx_ws_status ON cashback_transactions(workspace_id, status);
CREATE INDEX idx_cashback_tx_ws_expira ON cashback_transactions(workspace_id, status, expira_em);
CREATE INDEX idx_cashback_tx_ws_email ON cashback_transactions(workspace_id, email);
CREATE INDEX idx_cashback_tx_confirmado ON cashback_transactions(workspace_id, status, confirmado_em) WHERE status = 'AGUARDANDO_DEPOSITO';

ALTER TABLE cashback_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view cashback_transactions"
  ON cashback_transactions FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage cashback_transactions"
  ON cashback_transactions FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 3. cashback_events — append-only audit log
-- ============================================================

CREATE TABLE IF NOT EXISTS cashback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cashback_id UUID NOT NULL REFERENCES cashback_transactions(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cashback_events_cashback ON cashback_events(cashback_id, created_at DESC);
CREATE INDEX idx_cashback_events_ws_tipo ON cashback_events(workspace_id, tipo, created_at DESC);

ALTER TABLE cashback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view cashback_events"
  ON cashback_events FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage cashback_events"
  ON cashback_events FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 4. cashback_reminder_templates — per (workspace, canal, estagio)
-- ============================================================

CREATE TABLE IF NOT EXISTS cashback_reminder_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  estagio TEXT NOT NULL CHECK (estagio IN (
    'LEMBRETE_1', 'LEMBRETE_2', 'LEMBRETE_3', 'REATIVACAO', 'REATIVACAO_LEMBRETE'
  )),

  -- Per stage/channel enable flag (used only when channel_mode='custom')
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- WhatsApp-specific
  wa_template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  wa_template_name TEXT,
  wa_template_language TEXT DEFAULT 'pt_BR',

  -- Email-specific
  email_subject TEXT,
  email_body_html TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id, canal, estagio)
);

CREATE INDEX idx_cashback_templates_ws ON cashback_reminder_templates(workspace_id);

ALTER TABLE cashback_reminder_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view cashback_reminder_templates"
  ON cashback_reminder_templates FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage cashback_reminder_templates"
  ON cashback_reminder_templates FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 5. smtp_config — Email provider (Locaweb first)
-- ============================================================

CREATE TABLE IF NOT EXISTS smtp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'locaweb' CHECK (provider IN ('locaweb', 'resend', 'sendgrid', 'custom')),
  api_token TEXT NOT NULL,          -- encrypted via src/lib/encryption.ts
  from_email TEXT NOT NULL,
  from_name TEXT,
  reply_to TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE smtp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view smtp_config"
  ON smtp_config FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage smtp_config"
  ON smtp_config FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 6. troquecommerce_config — per workspace token
-- ============================================================

CREATE TABLE IF NOT EXISTS troquecommerce_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  api_token TEXT NOT NULL,          -- encrypted
  base_url TEXT NOT NULL DEFAULT 'https://www.troquecommerce.com.br',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE troquecommerce_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view troquecommerce_config"
  ON troquecommerce_config FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage troquecommerce_config"
  ON troquecommerce_config FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 7. Extend vnda_connections with enable_cashback flag
-- ============================================================

ALTER TABLE vnda_connections
  ADD COLUMN IF NOT EXISTS enable_cashback BOOLEAN NOT NULL DEFAULT false;
