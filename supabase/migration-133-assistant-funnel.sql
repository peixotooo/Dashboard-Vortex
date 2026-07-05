-- Migration 133: Chat Commerce v2 — funil de eventos + atribuição de pedidos
--
-- Mede a CONVERSÃO REAL do assistente /chat ponta a ponta: abriu → conversou →
-- viu produto → clicou → botou na sacola → checkout → COMPROU. Espelha o padrão
-- de checkout_events (sem PII crua). O elo da atribuição é o atk = session_key
-- do chat (== assistant_conversations.session_key), um id opaco de sessão.
--
-- Aplicar manualmente no Supabase (padrão do projeto).

-- ============================================================
-- 0. Índice durável de produtos mostrados por conversa
--    (o /chat resolve "a primeira/a preta" pelo ID EXATO já mostrado, sem
--     re-buscar — corrige o add-to-cart que trazia a peça errada)
-- ============================================================
ALTER TABLE assistant_conversations
  ADD COLUMN IF NOT EXISTS recent_products JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 1. Eventos do funil
-- ============================================================
CREATE TABLE IF NOT EXISTS public.assistant_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  UUID   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- atk = session_key do chat. Opaco, sem PII. É a cola da atribuição.
  atk           TEXT   NOT NULL CHECK (char_length(atk) <= 128
                                       AND atk ~ '^[A-Za-z0-9_-]+$'),
  event_type    TEXT   NOT NULL CHECK (event_type IN (
                  'chat_opened','session_started','message_sent',
                  'products_shown','product_card_click','add_to_cart',
                  'cart_viewed','checkout_handoff','handoff_landed',
                  'order_placed')),
  surface       TEXT   CHECK (surface IN ('global','pdp','unknown')),
  product_id    TEXT   CHECK (char_length(product_id) <= 64),   -- SKU-pai
  product_ids   TEXT[],                                          -- p/ products_shown
  value_bucket  TEXT   CHECK (value_bucket IN
                  ('0-99','100-199','200-349','350-599','600+')),
  path          TEXT   CHECK (char_length(path) <= 300),         -- só pathname
  metadata      JSONB  NOT NULL DEFAULT '{}'::jsonb,             -- chaves allowlisted
  order_code    TEXT   CHECK (char_length(order_code) <= 64),    -- só em order_placed
  ip_hash       TEXT   CHECK (char_length(ip_hash) <= 64),       -- hash, nunca IP
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_events_ws_time
  ON public.assistant_events (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS assistant_events_atk
  ON public.assistant_events (workspace_id, atk);
CREATE INDEX IF NOT EXISTS assistant_events_type
  ON public.assistant_events (workspace_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS assistant_events_order
  ON public.assistant_events (workspace_id, order_code)
  WHERE order_code IS NOT NULL;

-- ============================================================
-- 2. Atribuição sessão do chat -> pedido VNDA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.assistant_attributions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id      UUID   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- atk = session_key do chat. NULLABLE de propósito: o webhook VNDA e a
  -- confirmação client-side podem chegar em qualquer ordem — quem chega
  -- primeiro cria a linha (o webhook sem atk, só com receita), o outro
  -- completa a sua parte (atk pela confirmação; receita pelo webhook). Só conta
  -- como ATRIBUÍDO quando atk IS NOT NULL e revenue_confirmed.
  atk               TEXT,                        -- session_key do chat (pode faltar)
  order_code        TEXT   NOT NULL,            -- code do pedido VNDA
  source            TEXT   NOT NULL DEFAULT 'client_confirmation'
                    CHECK (source IN ('client_confirmation','probabilistic')),
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.00
                    CHECK (confidence >= 0 AND confidence <= 1),
  -- Preenchidos pelo WEBHOOK VNDA (ground-truth, receita REAL = bússola MER):
  order_total       NUMERIC(12,2),
  order_subtotal    NUMERIC(12,2),
  order_discount    NUMERIC(12,2),
  order_items       JSONB,                       -- [{sku, qty, total}]
  revenue_confirmed BOOLEAN NOT NULL DEFAULT false,
  handoff_at        TIMESTAMPTZ,                 -- do checkout_handoff
  confirmed_at      TIMESTAMPTZ,                 -- do pedido VNDA
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um pedido é atribuído a UMA sessão. Idempotência do webhook/confirmação.
  UNIQUE (workspace_id, order_code)
);

CREATE INDEX IF NOT EXISTS assistant_attr_ws_time
  ON public.assistant_attributions (workspace_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS assistant_attr_atk
  ON public.assistant_attributions (workspace_id, atk);

-- ============================================================
-- 3. RLS: leitura só pelo dashboard (membros); escrita só via service role.
-- ============================================================
ALTER TABLE public.assistant_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_attributions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view assistant_events" ON public.assistant_events
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Members view assistant_attributions" ON public.assistant_attributions
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
