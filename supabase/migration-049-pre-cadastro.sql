-- Migration 049: Pre-cadastro de produtos via IA
-- Upload de fotos + analise por IA + revisao + envio ao Eccosys

-- ============================================================
-- 1. Colecoes de produtos
-- ============================================================

CREATE TABLE IF NOT EXISTS product_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  context_description TEXT,
  template_ecc_id INT,
  template_data JSONB,
  categories_snapshot JSONB,
  status VARCHAR(20) DEFAULT 'draft',
  total_items INT DEFAULT 0,
  submitted_items INT DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE INDEX idx_product_collections_ws ON product_collections(workspace_id);

ALTER TABLE product_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view product_collections"
  ON product_collections FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage product_collections"
  ON product_collections FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================================
-- 2. Itens da colecao (1 por imagem/produto)
-- ============================================================

CREATE TABLE IF NOT EXISTS collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES product_collections(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Source
  original_filename VARCHAR(300) NOT NULL,
  image_storage_key TEXT NOT NULL,
  image_public_url TEXT NOT NULL,

  -- AI-generated fields
  nome VARCHAR(300),
  codigo VARCHAR(100),
  descricao_ecommerce TEXT,
  descricao_complementar TEXT,

  -- Manual / editable fields
  preco DECIMAL(10,2),
  peso DECIMAL(10,3),
  largura DECIMAL(10,2),
  altura DECIMAL(10,2),
  comprimento DECIMAL(10,2),
  gtin VARCHAR(20),

  -- Template-inherited fields
  ncm VARCHAR(20),
  unidade VARCHAR(10),
  origem VARCHAR(5),
  id_fornecedor VARCHAR(20),

  -- Categorization
  departamento_id VARCHAR(20),
  categoria_id VARCHAR(20),
  subcategoria_id VARCHAR(20),
  departamento_nome VARCHAR(200),
  categoria_nome VARCHAR(200),
  subcategoria_nome VARCHAR(200),

  -- AI metadata
  ai_raw_response JSONB,
  ai_confidence JSONB,
  ai_model VARCHAR(50),
  ai_processed_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(20) DEFAULT 'pending',
  ecc_product_id INT,
  error_msg TEXT,
  user_edits JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_collection_items_ws ON collection_items(workspace_id);
CREATE INDEX idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX idx_collection_items_status ON collection_items(status);
CREATE INDEX idx_collection_items_coll_status ON collection_items(collection_id, status);

ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view collection_items"
  ON collection_items FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage collection_items"
  ON collection_items FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
