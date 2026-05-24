-- Migration 093: corrigir unique constraint em abandoned_carts pra ON CONFLICT funcionar
--
-- A migration 089 criou um PARTIAL unique index:
--   CREATE UNIQUE INDEX idx_abandoned_carts_token
--     ON abandoned_carts (workspace_id, vnda_cart_token)
--     WHERE vnda_cart_token IS NOT NULL;
--
-- Supabase JS (`.upsert({...}, { onConflict: "workspace_id,vnda_cart_token" })`)
-- exige UNIQUE constraint NÃO-partial. Com index parcial, todo webhook
-- falhava com:
--   code=42P10 | there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
--
-- Fix: drop o partial index e cria UNIQUE constraint normal. Postgres trata
-- NULLs como DISTINCT por padrão (cada NULL é único pra fins de constraint),
-- então rows com vnda_cart_token=NULL continuam podendo coexistir múltiplos.

DROP INDEX IF EXISTS idx_abandoned_carts_token;

-- Idempotente: só adiciona se ainda não existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'abandoned_carts_workspace_token_unique'
  ) THEN
    ALTER TABLE abandoned_carts
      ADD CONSTRAINT abandoned_carts_workspace_token_unique
      UNIQUE (workspace_id, vnda_cart_token);
  END IF;
END $$;
