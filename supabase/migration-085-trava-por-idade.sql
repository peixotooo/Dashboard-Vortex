-- supabase/migration-085-trava-por-idade.sql
--
-- Trava de margem escalonada por idade do SKU. Inspirado na curva do slide
-- "Resultados" do SDD G4 (Digital Commerce): margem cai conforme idade sobe.
--
-- Hoje: trava_margem_minima_pct é flat (25% pra todo SKU).
-- Problema: SKU parado há 200d compete com lançamento de 10d. Margem em
-- estoque velho é "papel" — capital travado custa mais que a margem perdida.
--
-- Solução: 4 faixas configuráveis. Engine pega a trava da faixa em que o
-- SKU está e usa ela na validação do markdown.
--
-- Default Bulking (alinhado com curva G4):
--   1-30d:    35% (lançamento, preserva margem)
--   31-90d:   25% (regular)
--   91-120d:  15% (queima começa)
--   121+d:    5%  (queimar antes de virar passivo)
--
-- trava_margem_minima_pct (antiga) permanece como fallback caso a curva
-- esteja desabilitada (trava_por_idade_enabled=false).

alter table public.pricing_engine_settings
  add column if not exists trava_por_idade_enabled boolean
    not null default true;

alter table public.pricing_engine_settings
  add column if not exists trava_idade_1_30_pct numeric(6,4)
    not null default 0.35;

alter table public.pricing_engine_settings
  add column if not exists trava_idade_31_90_pct numeric(6,4)
    not null default 0.25;

alter table public.pricing_engine_settings
  add column if not exists trava_idade_91_120_pct numeric(6,4)
    not null default 0.15;

alter table public.pricing_engine_settings
  add column if not exists trava_idade_121_plus_pct numeric(6,4)
    not null default 0.05;

comment on column public.pricing_engine_settings.trava_por_idade_enabled is
  'Quando true, engine usa trava escalonada por idade. Quando false, usa trava_margem_minima_pct flat.';
