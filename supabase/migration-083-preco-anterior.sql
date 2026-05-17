-- supabase/migration-083-preco-anterior.sql
--
-- Adiciona preco_por_anterior em sku_pricing_history pra preservar o
-- preço que o produto estava sendo praticado ANTES da decisão do engine.
--
-- Atualmente sku_pricing_history.preco_por guarda só o preço NOVO (sugerido
-- ou aplicado). Sem o preço anterior, a UI mostra "De [preço cheio] → [novo]"
-- — confuso quando o SKU já estava em sale_price.
--
-- Com essa coluna, mostramos:
--   "Atual R$ 99 → Sugerido R$ 87 (Δ -12%)  · MSRP R$ 159"
-- em vez de:
--   "De R$ 159 → R$ 87 (Δ -45%)"

alter table public.sku_pricing_history
  add column if not exists preco_por_anterior numeric(14,2);

-- Backfill: pra rows existentes onde não há preço anterior, usamos preco_por
-- como aproximação (não temos como recuperar o estado pré-decisão).
update public.sku_pricing_history
  set preco_por_anterior = preco_por
  where preco_por_anterior is null;
