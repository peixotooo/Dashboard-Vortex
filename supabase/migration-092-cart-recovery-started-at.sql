-- Migration 092: recovery_started_at em abandoned_carts
--
-- Quando importamos carts retroativamente da API VNDA, NÃO queremos
-- disparar todos os steps de uma vez (cart de 3 dias atrás teria Step 1
-- 30min, Step 2 24h e Step 3 72h vencidos simultaneamente).
--
-- Solução: nova coluna recovery_started_at. O cron usa
-- COALESCE(recovery_started_at, abandoned_at) pra calcular delays E expire.
--   - NULL (caso normal, webhook real) → usa abandoned_at (sem mudança)
--   - Setado pelo import retroativo = now() → régua começa do zero pra
--     esse cart, abandoned_at original fica preservado pra métrica.

ALTER TABLE abandoned_carts
  ADD COLUMN IF NOT EXISTS recovery_started_at TIMESTAMPTZ;

-- Index pra o cron filtrar/ordenar carts open por start. Inclui na mesma
-- partial index condition pra ficar rápido.
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_open_started
  ON abandoned_carts (workspace_id, COALESCE(recovery_started_at, abandoned_at))
  WHERE status = 'open';
