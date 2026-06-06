-- Migration 109: Reviews (avaliações de clientes) — plataforma própria
--
-- Substitui a dependência da Yourviews por uma estrutura própria, no mesmo
-- molde das outras features que injetam conteúdo na loja via shelves.js
-- (prateleiras, cupons auto, topbar). O fluxo tem 3 partes:
--
--   1. EXTRAÇÃO  — importar todas as avaliações que já temos na Yourviews
--      (API V1, paginada) pra dentro de `reviews`, reaproveitando o histórico.
--   2. EXIBIÇÃO  — o widget no shelves.js lê `reviews` (público, via shelf_api_keys)
--      e renderiza o bloco de avaliações na página de produto.
--   3. COLETA    — régua de comunicação pós-compra: depois de N dias o cliente
--      recebe um pedido (WhatsApp/email) pra avaliar o produto + enviar fotos/vídeo.
--      `review_requests` é a fila dessa régua; novas avaliações nascem em `reviews`
--      com source='native'.
--
-- Acesso: RLS habilitado SEM policies de cliente — toda leitura/escrita passa
-- pelo servidor via service_role (createAdminClient) ou pelos endpoints públicos
-- validados por shelf_api_keys. Mantém as tabelas trancadas pro browser, igual
-- ao fluxo de instagram_snapshots / crons.

-- ============================================================
-- 1. yourviews_connections — credenciais da API V1 (1 por workspace)
-- ------------------------------------------------------------
-- Credenciais obtidas no painel Yourviews (Conta > Código da Loja).
-- store_key / api_username / api_password são guardados criptografados
-- (AES-256-GCM, src/lib/encryption.ts), igual a vnda_connections.
-- ============================================================

CREATE TABLE IF NOT EXISTS yourviews_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  store_key TEXT NOT NULL,        -- GUID da loja (criptografado)
  api_username TEXT NOT NULL,     -- Basic Auth user (criptografado)
  api_password TEXT NOT NULL,     -- Basic Auth senha (criptografado)

  -- Estado da última extração (pra mostrar no admin).
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,          -- 'ok' | 'error' | 'running'
  last_sync_message TEXT,
  total_imported INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT yourviews_connections_unique_ws UNIQUE (workspace_id)
);

ALTER TABLE yourviews_connections ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. reviews — avaliações (importadas da Yourviews + nativas)
-- ------------------------------------------------------------
-- `source` distingue origem: 'yourviews' (carga inicial) e 'native' (coletadas
-- pela nossa régua). `external_id` é o ReviewId da Yourviews, usado pra upsert
-- idempotente (re-rodar a extração não duplica). product_id casa com o id de
-- produto da VNDA (mesmo identificador usado nas prateleiras).
-- ============================================================

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  source TEXT NOT NULL DEFAULT 'native',   -- 'yourviews' | 'native'
  external_id TEXT,                         -- Yourviews ReviewId (idempotência)

  -- Produto avaliado (snapshot no momento da avaliação).
  product_id TEXT,
  product_name TEXT,
  product_url TEXT,
  product_image TEXT,
  product_sku TEXT,

  -- Conteúdo da avaliação.
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,

  -- Autor. email/IP são dados pessoais (LGPD) — só o servidor lê.
  author_name TEXT,
  author_email TEXT,
  verified_buyer BOOLEAN NOT NULL DEFAULT false,  -- Yourviews BoughtProduct
  reference_order TEXT,

  -- Campos de formulário (Veste, Comprimento, Meu tamanho, Altura, Formato do
  -- corpo, etc.) — array [{name, values:[...]}], igual ao CustomFields da Yourviews.
  custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Mídia enviada pelo cliente: [{url, type:'image'|'video', thumb?}].
  media JSONB NOT NULL DEFAULT '[]'::jsonb,

  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,

  -- Moderação. Importados entram 'published'; nativos podem entrar 'pending'
  -- conforme review_settings.auto_publish.
  status TEXT NOT NULL DEFAULT 'published',   -- 'published' | 'pending' | 'rejected' | 'hidden'

  -- Resposta pública da loja (opcional).
  reply_body TEXT,
  reply_at TIMESTAMPTZ,

  reviewed_at TIMESTAMPTZ,    -- data original da avaliação (Yourviews Date)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Upsert idempotente da extração. external_id pode ser NULL (avaliações
  -- nativas), e UNIQUE no Postgres ignora linhas com NULL — então só de-dup
  -- as importadas, que é o que queremos.
  CONSTRAINT reviews_unique_source_external UNIQUE (workspace_id, source, external_id)
);

-- Lookup do widget: avaliações publicadas de um produto, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS idx_reviews_ws_product
  ON reviews (workspace_id, product_id, status, reviewed_at DESC);

-- Lookup do admin/moderação: fila por status.
CREATE INDEX IF NOT EXISTS idx_reviews_ws_status
  ON reviews (workspace_id, status, created_at DESC);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. review_settings — config do widget + da régua (1 por workspace)
-- ============================================================

CREATE TABLE IF NOT EXISTS review_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Widget na loja.
  widget_enabled BOOLEAN NOT NULL DEFAULT true,
  accent_color TEXT NOT NULL DEFAULT '#e6b800',   -- cor das estrelas
  star_color TEXT NOT NULL DEFAULT '#e6b800',
  anchor_selector TEXT,                            -- onde injetar (null = auto)
  show_verified_badge BOOLEAN NOT NULL DEFAULT true,
  show_custom_fields BOOLEAN NOT NULL DEFAULT true,
  reviews_per_page INTEGER NOT NULL DEFAULT 10,

  -- Moderação de avaliações nativas.
  auto_publish BOOLEAN NOT NULL DEFAULT false,     -- false = entra como 'pending'

  -- Régua de comunicação pós-compra.
  request_enabled BOOLEAN NOT NULL DEFAULT false,
  request_channel TEXT NOT NULL DEFAULT 'whatsapp', -- 'whatsapp' | 'email'
  request_trigger TEXT NOT NULL DEFAULT 'purchase', -- 'purchase' | 'delivery'
  request_delay_days INTEGER NOT NULL DEFAULT 7,    -- dias após o gatilho
  request_ask_media BOOLEAN NOT NULL DEFAULT true,  -- pedir fotos/vídeo
  request_reminder_days INTEGER,                    -- null = sem lembrete
  request_message_template TEXT,                    -- {nome}, {produto}, {link}

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE review_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. review_requests — fila da régua de comunicação pós-compra
-- ------------------------------------------------------------
-- Um pedido = "convide o cliente X a avaliar o produto Y". Criado quando uma
-- compra entra (webhook VNDA / cron), agendado pra request_delay_days depois.
-- `token` é o identificador público da landing de coleta (sem expor email).
-- ============================================================

CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Origem (pedido VNDA).
  order_id TEXT,
  order_code TEXT,

  -- Cliente.
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,

  -- Produto a avaliar.
  product_id TEXT,
  product_name TEXT,
  product_image TEXT,
  product_url TEXT,

  channel TEXT NOT NULL DEFAULT 'whatsapp',  -- 'whatsapp' | 'email'
  scheduled_for TIMESTAMPTZ NOT NULL,         -- quando disparar

  -- 'pending'   — agendado, ainda não enviado
  -- 'sent'      — mensagem enviada, aguardando resposta
  -- 'reminded'  — lembrete enviado
  -- 'completed' — cliente avaliou (review_id preenchido)
  -- 'failed'    — falha no envio
  -- 'cancelled' — cancelado (ex.: cliente pediu opt-out)
  status TEXT NOT NULL DEFAULT 'pending',

  token TEXT NOT NULL,                         -- id público da landing de coleta
  sent_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT review_requests_token_unique UNIQUE (token),
  -- Um pedido por (cliente, produto, order) — evita reenviar o mesmo convite.
  CONSTRAINT review_requests_dedup UNIQUE (workspace_id, order_id, product_id)
);

-- Fila do cron: o que está pendente e já venceu o agendamento.
CREATE INDEX IF NOT EXISTS idx_review_requests_due
  ON review_requests (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_review_requests_ws
  ON review_requests (workspace_id, status, created_at DESC);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
