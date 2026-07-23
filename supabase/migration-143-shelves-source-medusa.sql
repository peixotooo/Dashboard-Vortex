-- Migration 143: Smart Shelves multi-source (VNDA + Medusa em paralelo)
--
-- A loja Medusa nova (app.bulking.com.br) ganha fonte PRÓPRIA no motor de
-- prateleiras: catálogo do Medusa, vendas do Medusa, GA4 da loja nova.
-- A loja VNDA continua bit-a-bit idêntica: todas as colunas novas são
-- ADITIVAS com DEFAULT 'vnda', então linhas/keys existentes não mudam.
--
-- ⚠️ ORDEM DE DEPLOY: rodar esta migração DEPOIS que o código da branch
-- feat/shelves-source-medusa estiver em produção. O código novo é tolerante
-- (funciona com ou sem estas colunas), mas o código ANTIGO usa
-- upsert onConflict(workspace_id,product_id) — esta migração troca essa
-- UNIQUE por (workspace_id,product_id,source), o que quebraria o
-- catalog-sync antigo até o próximo deploy. Recomendação: merge → deploy
-- → rodar este SQL no Supabase SQL Editor.
--
-- Identidade de produto: shelf_products.product_id continua sendo o id
-- numérico VNDA nas DUAS fontes (linhas medusa usam metadata.vnda_id do
-- produto Medusa) — widgets/reviews/promo continuam casando.

BEGIN;

-- ============================================================
-- 1. shelf_api_keys.source — cada chave pertence a uma loja
-- ============================================================
ALTER TABLE shelf_api_keys
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'vnda';
ALTER TABLE shelf_api_keys
  DROP CONSTRAINT IF EXISTS shelf_api_keys_source_check;
ALTER TABLE shelf_api_keys
  ADD CONSTRAINT shelf_api_keys_source_check CHECK (source IN ('vnda', 'medusa'));

-- ============================================================
-- 2. shelf_products.source — catálogos das duas lojas coexistem
-- ============================================================
ALTER TABLE shelf_products
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'vnda';
ALTER TABLE shelf_products
  DROP CONSTRAINT IF EXISTS shelf_products_source_check;
ALTER TABLE shelf_products
  ADD CONSTRAINT shelf_products_source_check CHECK (source IN ('vnda', 'medusa'));

-- Troca a UNIQUE (workspace_id, product_id) por (workspace_id, product_id, source)
-- para que a linha vnda e a linha medusa do MESMO produto coexistam.
-- Dropa por assinatura (não por nome) para ser robusto a renomes.
DO $$
DECLARE
  c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.shelf_products'::regclass
    AND con.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ) = ARRAY['product_id', 'workspace_id']
  LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.shelf_products DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE shelf_products
  DROP CONSTRAINT IF EXISTS shelf_products_workspace_product_source_key;
ALTER TABLE shelf_products
  ADD CONSTRAINT shelf_products_workspace_product_source_key
  UNIQUE (workspace_id, product_id, source);

CREATE INDEX IF NOT EXISTS idx_shelf_products_source
  ON shelf_products(workspace_id, source);

-- ============================================================
-- 3. shelf_consumer_history.source — histórico não contamina entre lojas
--    (PK passa a incluir source: mesmo consumer+produto pode existir 1x por loja)
-- ============================================================
ALTER TABLE shelf_consumer_history
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'vnda';
ALTER TABLE shelf_consumer_history
  DROP CONSTRAINT IF EXISTS shelf_consumer_history_source_check;
ALTER TABLE shelf_consumer_history
  ADD CONSTRAINT shelf_consumer_history_source_check
  CHECK (source IN ('vnda', 'medusa')) NOT VALID;

ALTER TABLE shelf_consumer_history
  DROP CONSTRAINT IF EXISTS shelf_consumer_history_pkey;
ALTER TABLE shelf_consumer_history
  ADD CONSTRAINT shelf_consumer_history_pkey
  PRIMARY KEY (workspace_id, consumer_id, product_id, source);

-- ============================================================
-- 4. shelf_events.source — eventos carimbados por loja
-- ============================================================
ALTER TABLE shelf_events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'vnda';
ALTER TABLE shelf_events
  DROP CONSTRAINT IF EXISTS shelf_events_source_check;
ALTER TABLE shelf_events
  ADD CONSTRAINT shelf_events_source_check
  CHECK (source IN ('vnda', 'medusa')) NOT VALID;

-- ============================================================
-- 5. shelf_sync_logs.source — observabilidade por fonte
-- ============================================================
ALTER TABLE shelf_sync_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'vnda';

-- ============================================================
-- 6. Chave nova da loja Medusa (mesmo workspace da key legada)
--    Idempotente: não duplica se rodar 2x.
--    Repo é público → o valor da key NÃO fica hardcoded aqui: é gerado
--    no banco. Depois de aplicar, leia o valor com:
--      SELECT key FROM shelf_api_keys WHERE source = 'medusa';
--    (Se a key já tiver sido criada por outro caminho — ex.: SQL de
--    aplicação entregue fora do repo — o NOT EXISTS pula este INSERT.)
-- ============================================================
INSERT INTO shelf_api_keys (workspace_id, name, source, key, active)
SELECT k.workspace_id,
       'Bulking App (Medusa)',
       'medusa',
       'pk_' || md5(gen_random_uuid()::text || clock_timestamp()::text),
       true
FROM shelf_api_keys k
WHERE k.name = 'Bulking Legacy Key'
  AND k.active = true
  AND NOT EXISTS (
    SELECT 1 FROM shelf_api_keys m
    WHERE m.source = 'medusa' AND m.name = 'Bulking App (Medusa)'
  )
LIMIT 1;

COMMIT;

-- Verificação rápida (rodar depois):
--   SELECT name, source, active, left(key, 8) || '…' AS key_masked FROM shelf_api_keys;
--   SELECT source, count(*) FROM shelf_products GROUP BY source;
