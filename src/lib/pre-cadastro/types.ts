// ============================================================
// Pre-cadastro de produtos via IA — Types
// ============================================================

export type CollectionStatus = "draft" | "processing" | "review" | "submitted";
export type CollectionItemStatus = "pending" | "processing" | "ready" | "edited" | "submitted" | "error";

export interface ProductCollection {
  id: string;
  workspace_id: string;
  name: string;
  context_description: string | null;
  template_ecc_id: number | null;
  template_data: TemplateData | TemplateData[] | null;
  categories_snapshot: CategoryNode[] | null;
  grade: string[];
  status: CollectionStatus;
  total_items: number;
  submitted_items: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateData {
  id: number;
  nome: string;
  codigo: string;
  cf: string;           // NCM
  unidade: string;
  origem: string;
  peso: string;
  pesoLiq: string;
  pesoBruto: string;
  largura: string;
  altura: string;
  comprimento: string;
  idFornecedor: string;
  tipoProducao: string;
  tipo: string;
  situacao: string;
  calcAutomEstoque: string;
  estoqueMinimo: string;
  estoqueMaximo: string;
  // Category info for AI matching
  categoria: string;
  departamento: string;
}

export interface CategoryNode {
  id: number | string;
  nome: string;
  idExterno?: string;
  categorias?: {
    id: number | string;
    nome: string;
    subcategorias?: {
      id: number | string;
      nome: string;
    }[];
  }[];
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  workspace_id: string;
  original_filename: string;
  image_storage_key: string;
  image_public_url: string;
  nome: string | null;
  codigo: string | null;
  descricao_ecommerce: string | null;
  descricao_complementar: string | null;
  preco: number | null;
  peso: number | null;
  largura: number | null;
  altura: number | null;
  comprimento: number | null;
  gtin: string | null;
  ncm: string | null;
  unidade: string | null;
  origem: string | null;
  id_fornecedor: string | null;
  keywords: string | null;
  metatag_description: string | null;
  titulo_pagina: string | null;
  url_slug: string | null;
  composicao: string | null;
  preco_custo: number | null;
  fabricante: string | null;
  descricao_detalhada: string | null;
  departamento_id: string | null;
  categoria_id: string | null;
  subcategoria_id: string | null;
  departamento_nome: string | null;
  categoria_nome: string | null;
  subcategoria_nome: string | null;
  ai_raw_response: unknown;
  ai_confidence: Record<string, number> | null;
  ai_model: string | null;
  ai_processed_at: string | null;
  status: CollectionItemStatus;
  ecc_product_id: number | null;
  error_msg: string | null;
  user_edits: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AIAnalysisResult {
  nome: string;
  descricao_ecommerce: string;
  descricao_complementar: string;
  descricao_detalhada: string;
  keywords: string;
  metatag_description: string;
  titulo_pagina: string;
  url_slug: string;
  composicao: string;
  departamento: { id: string; nome: string } | null;
  categoria: { id: string; nome: string } | null;
  subcategoria: { id: string; nome: string } | null;
  atributos_detectados: Record<string, string>;
  confidence: Record<string, number>;
  template_escolhido?: number;
}

export interface CollectionWithCounts extends ProductCollection {
  items_pending: number;
  items_ready: number;
  items_submitted: number;
  items_error: number;
}
