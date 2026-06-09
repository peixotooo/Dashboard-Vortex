-- Migration 105: Instagram snapshots (série temporal de seguidores + engajamento)
--
-- Hoje a tabela `instagram_profiles` guarda apenas o ÚLTIMO scrape (upsert),
-- então é impossível medir crescimento/variação ao longo do tempo. Esta tabela
-- grava UM snapshot por dia por perfil — seguidores, seguindo, posts e
-- agregados de engajamento calculados sobre os posts mais recentes no momento
-- da captura. A view de Instagram lê daqui pra montar séries e deltas.
--
-- Captura: cron diário (/api/cron/instagram-snapshot) + on-demand
-- (POST /api/instagram/snapshot, botão "Atualizar agora").
--
-- Acesso: RLS habilitado SEM policies de cliente — toda leitura/escrita passa
-- pelo servidor via service_role (createAdminClient), que ignora RLS. Mantém a
-- tabela trancada pro browser, igual ao fluxo dos crons.

-- ============================================================
-- 1. instagram_snapshots — 1 ponto por dia por perfil
-- ============================================================

CREATE TABLE IF NOT EXISTS instagram_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  username TEXT NOT NULL,

  -- Bucket do dia (timezone America/Sao_Paulo). UNIQUE garante 1 ponto/dia:
  -- re-rodar o cron ou clicar "Atualizar agora" no mesmo dia faz UPDATE.
  captured_on DATE NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Métricas do perfil no momento da captura.
  followers_count INTEGER NOT NULL,
  following_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,

  -- Engajamento agregado sobre os posts recentes amostrados na captura.
  -- engagement_rate (%) = (avg_likes + avg_comments) / followers * 100.
  -- Proxy público padrão (não temos alcance/impressões via scraping).
  posts_sampled INTEGER NOT NULL DEFAULT 0,
  avg_likes NUMERIC(12,2),
  avg_comments NUMERIC(12,2),
  engagement_rate NUMERIC(7,4),

  -- Origem do snapshot: 'cron' | 'manual' | 'backfill'.
  source TEXT NOT NULL DEFAULT 'cron',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT instagram_snapshots_unique_day UNIQUE (workspace_id, username, captured_on)
);

-- Lookup principal da view e dos deltas: perfil × série recente.
CREATE INDEX IF NOT EXISTS idx_instagram_snapshots_ws_user_date
  ON instagram_snapshots (workspace_id, username, captured_on DESC);

ALTER TABLE instagram_snapshots ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Seed opcional (idempotente) — ancora histórica da Bulking
-- ------------------------------------------------------------
-- A tabela instagram_profiles já tinha um scrape de 2026-03-09 com 287.159
-- seguidores. Reaproveitamos como primeiro ponto histórico pra que o gráfico
-- de crescimento já tenha uma âncora ao capturar o primeiro snapshot novo.
-- Seguro rodar várias vezes (ON CONFLICT DO NOTHING). Remova este bloco se
-- estiver aplicando num ambiente que não seja o da Bulking.
-- ============================================================

INSERT INTO instagram_snapshots
  (workspace_id, username, captured_on, captured_at, followers_count,
   following_count, posts_count, posts_sampled, source)
VALUES
  ('36f37e88-a9c7-4ed7-89b9-45e62b8bba04', 'bulkingoficial', DATE '2026-03-09',
   TIMESTAMPTZ '2026-03-09T02:21:28.925+00:00', 287159, 0, 5733, 0, 'backfill')
ON CONFLICT (workspace_id, username, captured_on) DO NOTHING;
