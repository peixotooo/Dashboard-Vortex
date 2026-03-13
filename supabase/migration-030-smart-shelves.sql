-- Migration 030: Smart Shelves - Prateleiras Inteligentes
-- Substitui SmartHint por sistema proprio de recomendacao

-- ============================================================
-- 1. shelf_products - Catalogo sincronizado da VNDA
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  price NUMERIC(12,2) NOT NULL,
  sale_price NUMERIC(12,2),
  image_url TEXT,
  image_url_2 TEXT,
  product_url TEXT,
  active BOOLEAN DEFAULT true,
  in_stock BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, product_id)
);

CREATE INDEX idx_shelf_products_workspace ON shelf_products(workspace_id);
CREATE INDEX idx_shelf_products_active ON shelf_products(workspace_id, active) WHERE active = true;
CREATE INDEX idx_shelf_products_category ON shelf_products(workspace_id, category);
CREATE INDEX idx_shelf_products_sale ON shelf_products(workspace_id) WHERE sale_price IS NOT NULL;
CREATE INDEX idx_shelf_products_created ON shelf_products(workspace_id, created_at DESC);

ALTER TABLE shelf_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view shelf products"
  ON shelf_products FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins can manage shelf products"
  ON shelf_products FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. shelf_events - Eventos de comportamento (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  consumer_id TEXT,
  event_type TEXT NOT NULL,
  product_id TEXT,
  page_type TEXT,
  shelf_config_id UUID,
  revenue NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shelf_events_product ON shelf_events(workspace_id, product_id, created_at DESC);
CREATE INDEX idx_shelf_events_consumer ON shelf_events(consumer_id, created_at DESC);
CREATE INDEX idx_shelf_events_session ON shelf_events(session_id, created_at DESC);
CREATE INDEX idx_shelf_events_type ON shelf_events(workspace_id, event_type, created_at DESC);
CREATE INDEX idx_shelf_events_cleanup ON shelf_events(created_at);

-- Service role only - no direct frontend access
ALTER TABLE shelf_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. shelf_rankings - Rankings pre-calculados
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_rankings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  product_id TEXT NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, algorithm, product_id)
);

CREATE INDEX idx_shelf_rankings_algo ON shelf_rankings(workspace_id, algorithm, score DESC);

ALTER TABLE shelf_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view rankings"
  ON shelf_rankings FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ============================================================
-- 4. shelf_configs - Configuracoes das prateleiras
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_type TEXT NOT NULL,
  position INT NOT NULL,
  anchor_selector TEXT,
  algorithm TEXT NOT NULL,
  title TEXT NOT NULL,
  max_products INT DEFAULT 12,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, page_type, position)
);

CREATE INDEX idx_shelf_configs_workspace ON shelf_configs(workspace_id, enabled);
CREATE INDEX idx_shelf_configs_page ON shelf_configs(workspace_id, page_type) WHERE enabled = true;

ALTER TABLE shelf_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view shelf configs"
  ON shelf_configs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins can manage shelf configs"
  ON shelf_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 5. shelf_consumer_history - Historico por consumidor
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_consumer_history (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  consumer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  views INT DEFAULT 1,
  last_seen TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, consumer_id, product_id)
);

CREATE INDEX idx_shelf_consumer_last ON shelf_consumer_history(workspace_id, consumer_id, last_seen DESC);

ALTER TABLE shelf_consumer_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. shelf_api_keys - Chaves de API publicas
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT 'default',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shelf_api_keys_lookup ON shelf_api_keys(key) WHERE active = true;
CREATE INDEX idx_shelf_api_keys_workspace ON shelf_api_keys(workspace_id);

ALTER TABLE shelf_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view api keys"
  ON shelf_api_keys FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "Admins can manage api keys"
  ON shelf_api_keys FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 7. shelf_sync_logs - Log de sincronizacao do catalogo
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  products_synced INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shelf_sync_logs_workspace ON shelf_sync_logs(workspace_id, created_at DESC);

ALTER TABLE shelf_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view sync logs"
  ON shelf_sync_logs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ============================================================
-- Triggers: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_shelf_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shelf_products_timestamp
  BEFORE UPDATE ON shelf_products
  FOR EACH ROW EXECUTE FUNCTION update_shelf_timestamp();

CREATE TRIGGER shelf_configs_timestamp
  BEFORE UPDATE ON shelf_configs
  FOR EACH ROW EXECUTE FUNCTION update_shelf_timestamp();

-- ============================================================
-- pg_cron jobs (executar manualmente no Supabase SQL Editor)
-- ============================================================

-- Atualiza BestSellers a cada 5 minutos
-- SELECT cron.schedule('shelf-bestsellers', '*/5 * * * *', $$
--   INSERT INTO shelf_rankings (workspace_id, algorithm, product_id, score)
--   SELECT e.workspace_id, 'bestsellers', e.product_id, COUNT(*) as score
--   FROM shelf_events e
--   WHERE e.event_type = 'order'
--     AND e.product_id IS NOT NULL
--     AND e.created_at > now() - interval '30 days'
--   GROUP BY e.workspace_id, e.product_id
--   ON CONFLICT (workspace_id, algorithm, product_id)
--   DO UPDATE SET score = EXCLUDED.score, updated_at = now();
-- $$);

-- Atualiza MostPopular a cada 5 minutos (pageviews 7 dias)
-- SELECT cron.schedule('shelf-most-popular', '*/5 * * * *', $$
--   INSERT INTO shelf_rankings (workspace_id, algorithm, product_id, score)
--   SELECT e.workspace_id, 'most_popular', e.product_id, COUNT(*) as score
--   FROM shelf_events e
--   WHERE e.event_type = 'pageview'
--     AND e.product_id IS NOT NULL
--     AND e.created_at > now() - interval '7 days'
--   GROUP BY e.workspace_id, e.product_id
--   ON CONFLICT (workspace_id, algorithm, product_id)
--   DO UPDATE SET score = EXCLUDED.score, updated_at = now();
-- $$);

-- Limpa eventos com mais de 90 dias (todo dia a meia-noite)
-- SELECT cron.schedule('shelf-cleanup-events', '0 0 * * *', $$
--   DELETE FROM shelf_events WHERE created_at < now() - interval '90 days';
-- $$);
