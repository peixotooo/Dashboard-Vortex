-- Migration 114: avaliação por PEDIDO com vários produtos (quiz por etapas).
--
-- Antes: a régua criava 1 pedido de avaliação só pro item principal da compra
-- (os outros produtos nunca eram avaliados). Agora cada pedido de avaliação
-- carrega TODOS os produtos comprados, e a landing vira um quiz: uma etapa por
-- produto + uma etapa pra experiência com a loja.
--
-- `products` = array [{ product_id, name, image, url }]. As colunas product_id/
-- product_name/product_image/product_url continuam apontando pro item principal
-- (usado na mensagem da régua e como fallback).

ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS products JSONB;

-- reviews.reference_order já existe (migration-109). A partir de agora ele é
-- preenchido com o código do pedido em cada avaliação coletada, pra que a
-- RECOMPENSA seja deduplicada POR PEDIDO (uma por pedido, não uma por produto).
CREATE INDEX IF NOT EXISTS idx_reviews_ws_reference_order
  ON reviews (workspace_id, reference_order)
  WHERE reference_order IS NOT NULL;
