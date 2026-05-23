-- Migration 089: Cart Recovery (abandoned cart)
-- Tabelas para receber webhook de carrinho abandonado da VNDA, configurar
-- régua editável (steps com delay + canais WhatsApp/Email) e logar
-- mensagens disparadas por step (idempotência via UNIQUE).

-- ============================================================
-- 1. abandoned_carts — carrinhos abandonados recebidos via webhook
-- ============================================================

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identificador único do carrinho no VNDA (token é o que aparece em URLs
  -- de recuperação; cart_id numérico é redundante mas guardamos pra
  -- correlacionar com /orders depois).
  vnda_cart_token TEXT,
  vnda_cart_id TEXT,

  -- Dados do cliente (lowercase no email pra match consistente).
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_name TEXT,

  -- Conteúdo do carrinho — items[] com {name, sku, qty, price, image_url, ...}
  items JSONB,
  cart_total NUMERIC(12,2),
  recovery_url TEXT,
  coupon_code TEXT,

  -- Estado da régua.
  status TEXT NOT NULL DEFAULT 'open',
    -- open: régua ativa
    -- recovered: cliente comprou (fechado pelo webhook de orders)
    -- closed: fechado manualmente
    -- expired: passou expire_after_hours sem compra
  abandoned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  raw_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: mesmo cart_token chegando duas vezes vira UPDATE, não duplicata.
CREATE UNIQUE INDEX IF NOT EXISTS idx_abandoned_carts_token
  ON abandoned_carts (workspace_id, vnda_cart_token)
  WHERE vnda_cart_token IS NOT NULL;

-- Lookup principal do cron: workspaces × carts abertos.
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_open
  ON abandoned_carts (workspace_id, status, abandoned_at)
  WHERE status = 'open';

-- Match por email pra fechar carts quando o cliente compra.
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email
  ON abandoned_carts (workspace_id, customer_email, status)
  WHERE status = 'open';

ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view abandoned_carts" ON abandoned_carts;
CREATE POLICY "Members can view abandoned_carts"
  ON abandoned_carts FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage abandoned_carts" ON abandoned_carts;
CREATE POLICY "Admins can manage abandoned_carts"
  ON abandoned_carts FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. cart_recovery_rules — 1 régua por workspace
-- ============================================================

CREATE TABLE IF NOT EXISTS cart_recovery_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  expire_after_hours INT NOT NULL DEFAULT 168, -- 7 dias
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE cart_recovery_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart_recovery_rules" ON cart_recovery_rules;
CREATE POLICY "Members can view cart_recovery_rules"
  ON cart_recovery_rules FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage cart_recovery_rules" ON cart_recovery_rules;
CREATE POLICY "Admins can manage cart_recovery_rules"
  ON cart_recovery_rules FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 3. cart_recovery_steps — passos da régua (ordenados)
-- ============================================================

CREATE TABLE IF NOT EXISTS cart_recovery_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES cart_recovery_rules(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  delay_minutes INT NOT NULL,

  -- Canal WhatsApp (opcional)
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  whatsapp_template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  -- Mapeia placeholders posicionais do template ({{1}}, {{2}}) pra variáveis
  -- do carrinho. Ex: {"1": "customer_first_name", "2": "recovery_url"}
  -- Variáveis disponíveis: customer_name, customer_first_name, cart_total,
  -- cart_total_formatted, first_item_name, items_count, recovery_url,
  -- coupon_code, store_name.
  whatsapp_variable_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Canal Email (opcional)
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Assunto e corpo HTML usam interpolação {{var_name}}.
  email_subject TEXT,
  email_body_html TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_steps_rule
  ON cart_recovery_steps (rule_id, step_order);

ALTER TABLE cart_recovery_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart_recovery_steps" ON cart_recovery_steps;
CREATE POLICY "Members can view cart_recovery_steps"
  ON cart_recovery_steps FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage cart_recovery_steps" ON cart_recovery_steps;
CREATE POLICY "Admins can manage cart_recovery_steps"
  ON cart_recovery_steps FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 4. cart_recovery_messages — log de mensagens disparadas
-- ============================================================
-- Idempotência: UNIQUE (cart_id, step_id, channel) — o cron só dispara
-- uma vez cada combinação. Se um step tem WA+Email, são duas rows.

CREATE TABLE IF NOT EXISTS cart_recovery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cart_id UUID NOT NULL REFERENCES abandoned_carts(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES cart_recovery_steps(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  status TEXT NOT NULL DEFAULT 'sent',
    -- sent: enfileirado/enviado com sucesso
    -- failed: erro permanente (não tenta de novo)
    -- skipped: pulado por config (ex: cliente sem telefone)
  error TEXT,
  external_id TEXT, -- wa_messages.id ou Locaweb message id
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_recovery_messages_unique
  ON cart_recovery_messages (cart_id, step_id, channel);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_messages_ws
  ON cart_recovery_messages (workspace_id, sent_at DESC);

ALTER TABLE cart_recovery_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart_recovery_messages" ON cart_recovery_messages;
CREATE POLICY "Members can view cart_recovery_messages"
  ON cart_recovery_messages FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage cart_recovery_messages" ON cart_recovery_messages;
CREATE POLICY "Admins can manage cart_recovery_messages"
  ON cart_recovery_messages FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
