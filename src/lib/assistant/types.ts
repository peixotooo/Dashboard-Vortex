// Tipos compartilhados do assistente de vendas da loja (widget de PDP).
//
// PRINCÍPIO DE SEGURANÇA: nada aqui carrega segredo, quantidade de estoque
// ou dado de cliente. Tudo que cruza a fronteira LLM/widget passa por estes
// tipos — se o campo não existe no tipo, ele não vaza.

export interface AssistantSettings {
  workspaceId: string;
  enabled: boolean;
  /** IDs de produto VNDA onde o widget aparece. Vazio = nenhum. ["*"] = todas as PDPs. */
  productIds: string[];
  model: string | null;
  title: string;
  welcomeMessage: string;
  suggestions: string[];
  storeInfo: string;
  /** Base de conhecimento institucional curada (trocas, frete, FAQ, ...). */
  institutionalKb: string;
  /** Pedir o primeiro nome do cliente antes de conversar. */
  askName: boolean;
  maxMessagesPerSession: number;
  dailyMessageCap: number;
  /** Chat Commerce v2: modo global (página /chat vende a loja toda). */
  globalEnabled: boolean;
  globalWelcome: string;
  globalSuggestions: string[];
}

// ---- Chat Commerce v2: blocos ricos ----
// O harness devolve uma lista de blocos que a página /chat renderiza. Cada
// bloco é 100% dado público de vitrine (mesma fronteira de segurança).

export interface ReviewsBlockData {
  scope: "product" | "store";
  productName?: string;
  average: number;
  count: number;
  highlights: Array<{ rating: number; body: string; author: string }>;
}

export interface BenefitsBlockData {
  items: string[];
  cashbackPercent: number;
}

export interface PromoBlockData {
  lines: string[];
}

/** Produto que o modelo pediu pra adicionar à sacola (cliente resolve a variante). */
export interface CartAddData {
  productId: string;
  size: string | null;
}

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "products"; layout: "carousel" | "cards"; title?: string; products: AssistantProductCard[] }
  | { type: "reviews"; data: ReviewsBlockData }
  | { type: "benefits"; data: BenefitsBlockData }
  | { type: "promo"; data: PromoBlockData }
  | { type: "cart_add"; data: CartAddData }
  | { type: "whatsapp" };

/** Card de produto exibido no widget — só dados públicos da vitrine. */
export interface AssistantProductCard {
  id: string;
  name: string;
  url: string;
  image_url: string | null;
  price: number | null;
  sale_price: number | null;
  available: boolean;
}

/** Produto como o LLM enxerga (resultado de tool). Sem quantidades de estoque. */
export interface AssistantProductSummary extends AssistantProductCard {
  fit: "oversized" | "regular";
  fabric: "dry" | "algodao" | "desconhecido";
  /** Composição derivada da tag ficha-tecnica (ex.: "96% ALGODÃO · 4% ELASTANO") ou null. */
  composition: string | null;
  /** Prazo de postagem derivado da tag sob-demanda (pronta entrega vs sob demanda). */
  shipping: string;
}

export interface AssistantSizeAvailability {
  size: string;
  available: boolean;
}

export interface AssistantProductDetails extends AssistantProductSummary {
  description: string | null;
  sizes: AssistantSizeAvailability[];
  /** Tabela de medidas REAL do produto (do popup da PDP), por molde, ou null. */
  sizeGuide: string | null;
  /** Galeria de imagens (VNDA), ordenada; fallback [image_url]. */
  images: string[];
}

export interface AssistantChatResult {
  reply: string;
  products: AssistantProductCard[];
  /** Modelo direcionou pro atendimento: widget mostra botão de WhatsApp. */
  showWhatsapp: boolean;
  /** Telemetria (persistida como role='tool', nunca replayada ao LLM). */
  toolLog: Array<{ name: string; input: unknown; ok: boolean }>;
  /** Chat Commerce v2: blocos ricos ordenados pra página /chat (v1 ignora). */
  blocks?: AssistantBlock[];
  /** Índice durável {id,name,sizes} dos produtos mostrados na sessão (p/ o carrinho). */
  recentProducts?: Array<{ id: string; name: string; sizes?: string[] }>;
  /** Modelo LLM usado no turno (haiku padrão ou o forte quando escala). */
  modelUsed?: string;
  /** Violações detectadas/corrigidas pelo guard determinístico de saída. */
  qualityFlags?: string[];
  /** Widget PDP (v1): produto+tamanho pra adicionar à sacola da loja (same-origin). */
  cartAdd?: { productId: string; size: string | null } | null;
}

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}
