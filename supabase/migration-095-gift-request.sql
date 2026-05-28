-- Migration 095: Pedir de presente — botão na PDP que dispara WhatsApp
-- (template de utilidade) para a pessoa que vai ser presenteada.
--
-- Reusa wa_campaigns/wa_messages (kind='gift_request') para que o cron
-- whatsapp-sender entregue via Meta Cloud API. gift_requests guarda os
-- metadados específicos da solicitação (produto, presenteador, presenteado).

-- ============================================================================
-- 1) gift_request_configs — 1 por workspace
-- ============================================================================

CREATE TABLE IF NOT EXISTS gift_request_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,

  -- Template WhatsApp (utilidade) que será disparado
  wa_template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  -- Mapping posicional {"1": "requester_name", "2": "product_name", ...}
  wa_variable_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Aparência do botão na PDP
  button_label TEXT DEFAULT 'Pedir de presente',
  button_bg_color TEXT DEFAULT '#000000',
  button_text_color TEXT DEFAULT '#ffffff',
  button_border_radius TEXT DEFAULT '4px',
  button_icon TEXT DEFAULT 'gift',  -- gift | heart | sparkles

  -- Modal
  modal_title TEXT DEFAULT 'Pedir de presente',
  modal_subtitle TEXT DEFAULT 'Avise alguém especial que você quer ganhar este produto',
  modal_name_label TEXT DEFAULT 'Seu nome',
  modal_phone_label TEXT DEFAULT 'WhatsApp da pessoa',
  modal_message_label TEXT DEFAULT 'Mensagem (opcional)',
  modal_cta_label TEXT DEFAULT 'Enviar pedido',
  modal_success_title TEXT DEFAULT 'Pedido enviado!',
  modal_success_message TEXT DEFAULT 'Aguarde — assim que a pessoa responder, você fica sabendo.',
  collect_requester_phone BOOLEAN DEFAULT false,

  -- Posicionamento
  pdp_anchor_selector TEXT,        -- null = padrão (próximo ao CTA principal)
  hide_on_pages TEXT[] DEFAULT ARRAY['cart', 'checkout', 'home', 'category']::TEXT[],

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_request_configs_workspace
  ON gift_request_configs(workspace_id) WHERE enabled = true;

-- ============================================================================
-- 2) gift_requests — cada solicitação individual
-- ============================================================================

CREATE TABLE IF NOT EXISTS gift_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Solicitante (quem quer ganhar)
  requester_name TEXT NOT NULL,
  requester_phone TEXT,             -- opcional (não usamos pra envio, só pra contato reverso)
  requester_session_id TEXT,
  requester_consumer_id TEXT,

  -- Presenteado (quem vai receber o WhatsApp)
  recipient_phone TEXT NOT NULL,

  -- Produto
  product_id TEXT NOT NULL,
  product_name TEXT,
  product_url TEXT,
  product_image_url TEXT,
  product_price NUMERIC(12, 2),

  -- Mensagem pessoal opcional do solicitante
  personal_message TEXT,

  -- Status (espelha lifecycle do WhatsApp + heurística de conversão)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'converted')),

  -- Vínculo com o canal de envio
  wa_campaign_id UUID REFERENCES wa_campaigns(id) ON DELETE SET NULL,
  wa_message_id UUID REFERENCES wa_messages(id) ON DELETE SET NULL,
  error_message TEXT,

  -- Heurística de conversão: matching com pedidos VNDA por phone+SKU em até N dias
  converted_order_id TEXT,
  converted_at TIMESTAMPTZ,

  -- Audit
  page_url TEXT,
  user_agent TEXT,
  ip_hash TEXT,                     -- sha256(ip + workspace) — anti-flood/anti-abuse

  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gift_requests_workspace_created
  ON gift_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_requests_workspace_status
  ON gift_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_requests_recipient
  ON gift_requests(workspace_id, recipient_phone);
CREATE INDEX IF NOT EXISTS idx_gift_requests_wa_message
  ON gift_requests(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gift_requests_product
  ON gift_requests(workspace_id, product_id);

-- Rate-limit / anti-flood: no máximo X pedidos do mesmo IP no mesmo dia
-- (a constraint não impede — só facilita o lookup pelo endpoint público)
CREATE INDEX IF NOT EXISTS idx_gift_requests_ip_day
  ON gift_requests(workspace_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

-- ============================================================================
-- 3) wa_campaigns.kind — adiciona 'gift_request' como tipo válido
-- ============================================================================
-- A coluna já existe (migration 094, default 'campaign'). Aqui só garantimos
-- que campanhas geradas pelo gift-request usem kind='gift_request' para
-- sumirem da listagem de /crm/whatsapp.

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE gift_request_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view gift_request_configs"
  ON gift_request_configs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins manage gift_request_configs"
  ON gift_request_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Members view gift_requests"
  ON gift_requests FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins manage gift_requests"
  ON gift_requests FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
