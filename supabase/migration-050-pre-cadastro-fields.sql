-- Migration 050: Add missing fields to collection_items based on real Eccosys CSV
-- Fields: SEO (keywords, metatag, titulo_pagina, url), composicao, preco_custo, fabricante

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS keywords TEXT;
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS metatag_description TEXT;
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS titulo_pagina VARCHAR(300);
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS url_slug VARCHAR(300);
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS composicao VARCHAR(300);
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS preco_custo DECIMAL(10,2);
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS fabricante VARCHAR(300);
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS descricao_detalhada TEXT;
