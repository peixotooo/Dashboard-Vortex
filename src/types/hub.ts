// ============================================================
// Hub Eccosys <-> Mercado Livre — Database types
// ============================================================

export interface EccosysConnection {
  id: string;
  workspace_id: string;
  api_token: string; // encrypted
  ambiente: string;
  created_at: string;
  updated_at: string;
}

export interface MLCredential {
  id: string;
  workspace_id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  access_token: string; // encrypted
  refresh_token: string; // encrypted
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type HubProductSource = "eccosys" | "ml";
export type HubProductSyncStatus = "draft" | "ready" | "synced" | "error";

// ML enriched data (stored in hub_products.ml_data JSONB)
export interface MLData {
  listing_type_id: string;
  condition: string;
  buying_mode: string;
  original_price: number | null;
  base_price: number | null;
  currency_id: string;
  catalog_listing: boolean;
  catalog_product_id: string | null;
  domain_id: string | null;
  free_shipping: boolean;
  shipping_mode: string | null;
  logistic_type: string | null;
  sold_quantity: number;
  health: number | null;
  visits: number | null;
  warranty: string | null;
  tags: string[];
  sub_status: string[];
  channels: string[];
  date_created: string;
  last_updated: string;
  start_time: string | null;
}

// ML enrichment data prepared FOR publishing (stored in hub_products.ml_enrichment JSONB)
export interface MLEnrichmentAttr {
  id: string;          // ML attribute ID: "BRAND", "COLOR", "MODEL"
  name: string;        // human-readable name
  value_name: string;  // actual value
  required: boolean;
  source: "eccosys" | "cross_ref" | "manual" | "default";
}

export interface MLEnrichment {
  category_id: string;
  category_name: string;
  category_path: string;
  listing_type_id: string;
  condition: string;
  buying_mode: string;
  attributes: MLEnrichmentAttr[];
  variation_attr_map: Record<string, string>; // { "Cor": "COLOR", "Tamanho": "SIZE" }
  sale_terms: Array<{ id: string; value_name: string }>;
  shipping: { mode: string; local_pick_up: boolean; free_shipping: boolean };
  cross_ref_source: string | null; // ml_item_id used as template
  enriched_at: string;
}

export interface HubProduct {
  id: string;
  workspace_id: string;

  // Eccosys side
  ecc_id: number | null;
  sku: string;
  nome: string | null;
  preco: number | null;
  preco_promocional: number | null;
  estoque: number;
  gtin: string | null;
  peso: number | null;
  largura: number | null;
  altura: number | null;
  comprimento: number | null;
  descricao: string | null;
  fotos: string[] | null;
  situacao: string;
  ecc_pai_id: number | null;
  ecc_pai_sku: string | null;
  atributos: Record<string, string>;

  // ML side
  ml_item_id: string | null;
  ml_variation_id: number | null;
  ml_category_id: string | null;
  ml_status: string | null;
  ml_permalink: string | null;
  ml_preco: number | null;
  ml_estoque: number | null;
  ml_data: MLData | null;
  ml_enrichment: MLEnrichment | null;

  // Control
  source: HubProductSource;
  linked: boolean;
  sob_demanda: boolean;
  sync_status: HubProductSyncStatus;
  last_ecc_sync: string | null;
  last_ml_sync: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

export type HubOrderSyncStatus =
  | "pending"
  | "imported"
  | "error"
  | "ignored"
  | "tracking_sent";

export interface HubOrderItem {
  sku: string;
  nome: string;
  qtd: number;
  preco: number;
  ml_item_id: string;
}

export interface HubOrder {
  id: string;
  workspace_id: string;

  // ML side
  ml_order_id: number;
  ml_shipment_id: number | null;
  ml_status: string | null;
  ml_date: string | null;
  buyer_name: string | null;
  buyer_doc: string | null;
  buyer_email: string | null;
  total: number | null;
  frete: number;
  items: HubOrderItem[];
  endereco: Record<string, unknown> | null;
  pagamento: Record<string, unknown> | null;

  // Eccosys side
  ecc_pedido_id: number | null;
  ecc_numero: string | null;
  ecc_situacao: number | null;
  ecc_nfe_numero: string | null;
  ecc_rastreio: string | null;

  // Control
  sync_status: HubOrderSyncStatus;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

export type HubLogAction =
  | "pull_eccosys"
  | "import_family"
  | "push_ml"
  | "pull_ml"
  | "pull_order"
  | "push_order_eccosys"
  | "sync_nfe"
  | "sync_stock"
  | "republish_ml"
  | "webhook_received"
  | "error";

export interface HubLog {
  id: string;
  workspace_id: string;
  action: HubLogAction;
  entity: string | null;
  entity_id: string | null;
  direction: string | null;
  status: "ok" | "error";
  details: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================
// Eccosys API response types
// ============================================================

export interface EccosysProduto {
  id: number;
  codigo: string;
  nome: string;
  preco: number;
  precoDe: number | null;
  precoCusto: number | null;
  precoPromocional: number | null;
  gtin: string | null;
  gtinEmbalagem: string | null;
  peso: number | null;
  pesoLiq: number | null;
  pesoBruto: number | null;
  largura: number | null;
  altura: number | null;
  comprimento: number | null;
  descricaoEcommerce: string | null;
  descricaoComplementar: string | null;
  situacao: string;
  unidade: string | null;
  cf: string | null; // NCM
  origem: string | null;
  // Parent reference: "0" = pai/simples, outro = ID do pai
  idProdutoMaster: string;
  // Legado (manter compat com codigo existente)
  idProdutoPai: number | null;
  codigoPai: string | null;
  // Categorizacao
  idTagMarcaArvore: string | null;
  idTagDepartamentoArvore: string | null;
  idTagCategoriaArvore: string | null;
  idTagSubcategoriaArvore: string | null;
  idFornecedor: string | null;
  // Fotos inline
  foto1: string | null;
  foto2: string | null;
  foto3: string | null;
  foto4: string | null;
  foto5: string | null;
  foto6: string | null;
  // Dados aninhados (apenas no GET individual /produtos/{id})
  _Skus?: Array<{ id: number; codigo: string; gtin: string; gtinEmbalagem: string }>;
  _Atributos?: Array<{ id: number; descricao: string; valor: string }>;
  _Estoque?: { estoqueReal: number; estoqueDisponivel: number; codigo: string; nome: string };
  _FichaTecnica?: Array<{ descricaoDetalhada: string }>;
  _VinculosPlataforma?: Array<{ idPlataforma: number; nomePlataforma: string; vinculoPai: string; vinculo: string }>;
  _Componentes?: Array<{ idProduto: number; quantidade: number }>;
}

export interface EccosysEstoque {
  estoqueReal: number;
  estoqueDisponivel: number;
  codigo: string;
  nome: string;
  idProduto: string;
}

export interface EccosysAtributo {
  id: number;
  descricao: string;
  valor: string;
}

export interface EccosysImagem {
  url: string;
}
