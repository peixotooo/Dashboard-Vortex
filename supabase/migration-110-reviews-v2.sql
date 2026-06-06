-- Migration 110: Reviews v2 — régua condicionada a faturamento/envio,
-- gamificação (recompensas por foto/vídeo/ADS), template WhatsApp e log
-- unificado de comunicações.
--
-- Contexto importante: a API da VNDA NÃO expõe nota fiscal/faturamento no
-- pedido (testado em GET /api/v2/orders/{code}). O hub Eccosys (hub_orders) é
-- só de Mercado Livre. Então usamos `shipped_at` (pedido enviado/despachado)
-- da VNDA como sinal de "faturado/processado" — é o que melhor resolve o caso
-- dos produtos sob demanda (não pedir avaliação antes de ter saído). Os campos
-- abaixo deixam isso configurável pra trocar por uma fonte real de NF no futuro.

-- ============================================================
-- 1. review_settings — novas colunas
-- ============================================================

-- Elegibilidade da régua (faturado/enviado + prazos)
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS request_require_invoice BOOLEAN NOT NULL DEFAULT true;
-- ^ só fala com o cliente se o pedido já foi enviado (proxy de faturado).
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS request_days_after_invoice INTEGER NOT NULL DEFAULT 9;
-- ^ enviar X dias após o faturamento/envio (data de shipped_at).
-- request_delay_days (já existe) passa a significar "mínimo de dias após a
-- compra confirmada" — default novo = 15 pra novos workspaces.
ALTER TABLE review_settings ALTER COLUMN request_delay_days SET DEFAULT 15;

-- Template WhatsApp (categoria UTILITY) usado na régua.
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS wa_template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL;
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS wa_variable_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Gamificação / recompensas
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS rewards_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS reward_photo_amount NUMERIC(10,2) NOT NULL DEFAULT 10;   -- cashback R$ por foto (unbox)
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS reward_video_amount NUMERIC(10,2) NOT NULL DEFAULT 30;   -- cashback R$ por vídeo
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS reward_video_ads_amount NUMERIC(10,2) NOT NULL DEFAULT 50; -- cashback R$ vídeo aceito p/ ADS
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS reward_validity_days INTEGER NOT NULL DEFAULT 60;        -- validade do cashback concedido
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS ads_enabled BOOLEAN NOT NULL DEFAULT true;              -- pedir consentimento de uso em ADS p/ vídeos

-- ============================================================
-- 2. reviews — mídia/gamificação/ADS/recompensa
-- ============================================================

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'none';  -- 'none' | 'photo' | 'video'
-- Consentimento do cliente pra usar o vídeo em anúncios (ADS).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ads_consent BOOLEAN NOT NULL DEFAULT false;
-- Curadoria do vídeo pra ADS: 'none' | 'pending' | 'accepted' | 'rejected'.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ads_status TEXT NOT NULL DEFAULT 'none';

-- Recompensa concedida ao cliente por essa avaliação.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_tier TEXT;            -- 'photo' | 'video' | 'video_ads'
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_status TEXT NOT NULL DEFAULT 'none'; -- 'none'|'pending'|'granted'|'failed'
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_amount NUMERIC(10,2);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_reference TEXT;       -- idempotência do crédito VNDA
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_granted_at TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reward_error TEXT;

-- Fila de vídeos aguardando curadoria de ADS.
CREATE INDEX IF NOT EXISTS idx_reviews_ads_pending
  ON reviews (workspace_id, ads_status) WHERE ads_status = 'pending';

-- ============================================================
-- 3. review_requests — estado da checagem de faturamento/envio
-- ============================================================

ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;     -- data de envio (VNDA shipped_at)
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS invoice_ok BOOLEAN NOT NULL DEFAULT false; -- pedido faturado/enviado?
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ; -- última consulta ao pedido na VNDA
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS defer_count INTEGER NOT NULL DEFAULT 0; -- quantas vezes adiamos esperando faturar

-- ============================================================
-- 4. crm_message_log — log unificado de comunicações (anti-sobreposição)
-- ------------------------------------------------------------
-- Toda comunicação automática (régua) registra aqui. Permite (a) a visão única
-- de comunicações por cliente e (b) o guard anti-sobreposição: antes de enviar
-- uma review, checa se o cliente recebeu outra comunicação recente.
-- Server-only (RLS sem policies de cliente).
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_email TEXT,
  customer_phone TEXT,
  channel TEXT NOT NULL,                 -- 'whatsapp' | 'email'
  source TEXT NOT NULL,                  -- 'review' | 'cashback' | 'cart_recovery' | 'campaign' | 'playbook' | 'group'
  source_id TEXT,                        -- id da entidade origem (review_request.id, etc.)
  status TEXT NOT NULL DEFAULT 'sent',   -- 'sent' | 'failed'
  message_id TEXT,                       -- id externo (W-API/Meta/email)
  meta JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Último contato com este cliente em qualquer régua" — por telefone e email.
CREATE INDEX IF NOT EXISTS idx_crm_msglog_phone ON crm_message_log (workspace_id, customer_phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_msglog_email ON crm_message_log (workspace_id, customer_email, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_msglog_source ON crm_message_log (workspace_id, source, sent_at DESC);

ALTER TABLE crm_message_log ENABLE ROW LEVEL SECURITY;
