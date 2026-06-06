-- Migration 111: régua de avaliação com 2-3 contatos + avaliação da loja
--
--   1. A régua de avaliação vira uma SEQUÊNCIA (1º pedido + até 2 lembretes).
--   2. Na landing, o cliente avalia o PRODUTO e a LOJA separadamente (mesma
--      página) — a avaliação da loja vai pra `store_reviews`.

-- ============================================================
-- 1. review_settings — 2º lembrete + coletar avaliação da loja
-- ============================================================

-- request_reminder_days (já existe) = dias do 1º lembrete após o 1º contato.
-- request_reminder_2_days = dias do 2º lembrete após o 1º lembrete (null = só 2 contatos).
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS request_reminder_2_days INTEGER;
ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS collect_store_review BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 2. review_requests — contador de lembretes (sequência)
-- ============================================================

ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 3. store_reviews — avaliação da LOJA (experiência/entrega), por pedido
-- ------------------------------------------------------------
-- Separada de `reviews` (que é por produto). Coletada na mesma landing.
-- Server-only (RLS sem policies de cliente).
-- ============================================================

CREATE TABLE IF NOT EXISTS store_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id TEXT,
  order_code TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  author_name TEXT,
  author_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'published' | 'hidden' | 'rejected'
  review_request_id UUID REFERENCES review_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uma avaliação de loja por pedido.
  CONSTRAINT store_reviews_order_unique UNIQUE (workspace_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_store_reviews_ws ON store_reviews (workspace_id, status, created_at DESC);

ALTER TABLE store_reviews ENABLE ROW LEVEL SECURITY;
