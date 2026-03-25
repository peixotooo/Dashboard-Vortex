-- Migration 043: Hub Eccosys <-> Mercado Livre
-- Middleware hub for product sync, order import, and NF-e/tracking

-- ============================================================
-- 1. Eccosys connection config (per workspace)
-- ============================================================

CREATE TABLE IF NOT EXISTS eccosys_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  api_token TEXT NOT NULL,
  ambiente TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX idx_eccosys_connections_ws ON eccosys_connections(workspace_id);

ALTER TABLE eccosys_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view eccosys_connections"
  ON eccosys_connections FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage eccosys_connections"
  ON eccosys_connections FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. ML OAuth credentials (per workspace)
-- ============================================================

CREATE TABLE IF NOT EXISTS ml_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ml_user_id BIGINT NOT NULL,
  ml_nickname VARCHAR(100),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, ml_user_id)
);

CREATE INDEX idx_ml_credentials_ws ON ml_credentials(workspace_id);
CREATE INDEX idx_ml_credentials_user ON ml_credentials(ml_user_id);

ALTER TABLE ml_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ml_credentials"
  ON ml_credentials FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage ml_credentials"
  ON ml_credentials FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 3. Hub products (central middleware table)
-- ============================================================

CREATE TABLE IF NOT EXISTS hub_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Eccosys side
  ecc_id INT,
  sku VARCHAR(100) NOT NULL,
  nome VARCHAR(300),
  preco DECIMAL(10,2),
  preco_promocional DECIMAL(10,2),
  estoque INT DEFAULT 0,
  gtin VARCHAR(20),
  peso DECIMAL(10,3),
  largura DECIMAL(10,2),
  altura DECIMAL(10,2),
  comprimento DECIMAL(10,2),
  descricao TEXT,
  fotos TEXT[],
  situacao VARCHAR(1) DEFAULT 'A',
  ecc_pai_id INT,
  ecc_pai_sku VARCHAR(100),
  atributos JSONB DEFAULT '{}',

  -- ML side
  ml_item_id VARCHAR(30),
  ml_variation_id BIGINT,
  ml_category_id VARCHAR(30),
  ml_status VARCHAR(20),
  ml_permalink VARCHAR(500),
  ml_preco DECIMAL(10,2),
  ml_estoque INT,

  -- Control
  source VARCHAR(10) NOT NULL,
  linked BOOLEAN DEFAULT FALSE,
  sync_status VARCHAR(20) DEFAULT 'draft',
  last_ecc_sync TIMESTAMPTZ,
  last_ml_sync TIMESTAMPTZ,
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, sku)
);

CREATE INDEX idx_hub_products_ws ON hub_products(workspace_id);
CREATE INDEX idx_hub_products_sku ON hub_products(workspace_id, sku);
CREATE INDEX idx_hub_products_ml ON hub_products(ml_item_id);
CREATE INDEX idx_hub_products_source ON hub_products(workspace_id, source);
CREATE INDEX idx_hub_products_sync ON hub_products(workspace_id, sync_status);

ALTER TABLE hub_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hub_products"
  ON hub_products FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage hub_products"
  ON hub_products FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 4. Hub orders (ML -> Hub -> Eccosys)
-- ============================================================

CREATE TABLE IF NOT EXISTS hub_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- ML side
  ml_order_id BIGINT NOT NULL,
  ml_shipment_id BIGINT,
  ml_status VARCHAR(30),
  ml_date TIMESTAMPTZ,
  buyer_name VARCHAR(200),
  buyer_doc VARCHAR(20),
  buyer_email VARCHAR(200),
  total DECIMAL(10,2),
  frete DECIMAL(10,2) DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]',
  endereco JSONB,
  pagamento JSONB,

  -- Eccosys side
  ecc_pedido_id INT,
  ecc_numero VARCHAR(50),
  ecc_situacao INT,
  ecc_nfe_numero VARCHAR(50),
  ecc_rastreio VARCHAR(100),

  -- Control
  sync_status VARCHAR(20) DEFAULT 'pending',
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(workspace_id, ml_order_id)
);

CREATE INDEX idx_hub_orders_ws ON hub_orders(workspace_id);
CREATE INDEX idx_hub_orders_ml ON hub_orders(ml_order_id);
CREATE INDEX idx_hub_orders_sync ON hub_orders(workspace_id, sync_status);

ALTER TABLE hub_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hub_orders"
  ON hub_orders FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage hub_orders"
  ON hub_orders FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 5. Hub activity logs
-- ============================================================

CREATE TABLE IF NOT EXISTS hub_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  entity VARCHAR(20),
  entity_id VARCHAR(100),
  direction VARCHAR(20),
  status VARCHAR(10) DEFAULT 'ok',
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_hub_logs_ws ON hub_logs(workspace_id, created_at DESC);
CREATE INDEX idx_hub_logs_action ON hub_logs(workspace_id, action);

ALTER TABLE hub_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hub_logs"
  ON hub_logs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage hub_logs"
  ON hub_logs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
