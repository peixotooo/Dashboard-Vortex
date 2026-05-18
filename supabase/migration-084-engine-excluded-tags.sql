-- supabase/migration-084-engine-combo-aware.sql
--
-- Faz o engine de pricing considerar promoções de combo VNDA na trava de
-- margem. Sem isso, markdown + combo se acumulam no checkout e a margem CM2
-- real pode ficar abaixo da trava configurada.
--
-- Três campos novos em pricing_engine_settings:
--
-- 1. combo_tag: nome da tag VNDA que marca produtos em combo (default 'combos').
--    Engine identifica via shelf_products.tags.
--
-- 2. combo_desconto_unitario_brl: pior cenário de desconto/un do combo
--    (default R$ 6,37 baseado na promoção Combos NP da Bulking: 3 un = -R$19,10).
--    Engine simula esse desconto extra ao validar trava de margem.
--
-- 3. engine_excluded_tags: lista opcional de tags pra excluir 100% do engine
--    (default vazio). Usado pra override manual de SKUs que não devem nunca
--    receber markdown automático, independente da margem.

alter table public.pricing_engine_settings
  add column if not exists engine_excluded_tags text[]
    not null default '{}'::text[];

alter table public.pricing_engine_settings
  add column if not exists combo_tag text
    not null default 'combos';

alter table public.pricing_engine_settings
  add column if not exists combo_desconto_unitario_brl numeric(10,2)
    not null default 6.37;

comment on column public.pricing_engine_settings.combo_tag is
  'Tag VNDA (shelf_products.tags) que identifica SKUs em combo. Engine simula desconto extra ao validar trava de margem desses produtos.';

comment on column public.pricing_engine_settings.combo_desconto_unitario_brl is
  'Pior cenário de desconto por unidade no combo VNDA. Engine subtrai esse valor ao calcular CM2 efetivo pós-checkout.';

comment on column public.pricing_engine_settings.engine_excluded_tags is
  'Tags VNDA que fazem o engine pular o SKU completamente (override manual). Default vazio — usar a regra de combo é mais inteligente.';
