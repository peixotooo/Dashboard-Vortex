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
  maxMessagesPerSession: number;
  dailyMessageCap: number;
}

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
  fabric: "dry" | "algodao";
  /** Composição derivada da tag ficha-tecnica (ex.: "96% ALGODÃO · 4% ELASTANO") ou null. */
  composition: string | null;
}

export interface AssistantSizeAvailability {
  size: string;
  available: boolean;
}

export interface AssistantProductDetails extends AssistantProductSummary {
  description: string | null;
  sizes: AssistantSizeAvailability[];
}

export interface AssistantChatResult {
  reply: string;
  products: AssistantProductCard[];
  /** Telemetria (persistida como role='tool', nunca replayada ao LLM). */
  toolLog: Array<{ name: string; input: unknown; ok: boolean }>;
}

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}
