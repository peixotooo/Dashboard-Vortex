import { createAdminClient } from "@/lib/supabase-admin";
import type { AssistantSettings } from "./types";

const DEFAULTS = {
  title: "Assistente Bulking",
  welcomeMessage:
    "Oi! Te ajudo a escolher o tamanho, conferir medidas, tecido e prazo desta peça. O que você quer saber?",
  suggestions: [
    "Descobrir meu tamanho",
    "Ver medidas desta peça",
    "Qual o prazo de envio?",
    "Me recomenda produtos parecidos",
  ],
  maxMessagesPerSession: 30,
  dailyMessageCap: 1500,
};

export async function getAssistantSettings(
  workspaceId: string
): Promise<AssistantSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assistant_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) {
    // Sem linha = desabilitado (fail-closed)
    return {
      workspaceId,
      enabled: false,
      productIds: [],
      model: null,
      title: DEFAULTS.title,
      welcomeMessage: DEFAULTS.welcomeMessage,
      suggestions: DEFAULTS.suggestions,
      storeInfo: "",
      institutionalKb: "",
      askName: false,
      maxMessagesPerSession: DEFAULTS.maxMessagesPerSession,
      dailyMessageCap: DEFAULTS.dailyMessageCap,
      globalEnabled: false,
      globalWelcome: "",
      globalSuggestions: [],
    };
  }

  return {
    workspaceId,
    enabled: data.enabled === true,
    productIds: Array.isArray(data.product_ids)
      ? (data.product_ids as string[]).map(String)
      : [],
    model: typeof data.model === "string" && data.model.trim() ? data.model.trim() : null,
    title: data.title || DEFAULTS.title,
    // A string legada "Fala! ..." veio do DEFAULT da coluna (migration-126) —
    // trata como não-customizada pra o texto novo valer sem mexer no banco. Se
    // o lojista escreveu um welcome próprio, esse é respeitado.
    welcomeMessage:
      typeof data.welcome_message === "string" &&
      data.welcome_message.trim() &&
      !data.welcome_message.startsWith("Fala! Sou o assistente da loja.")
        ? data.welcome_message
        : DEFAULTS.welcomeMessage,
    suggestions: Array.isArray(data.suggestions)
      ? (data.suggestions as unknown[]).filter((s) => typeof s === "string").slice(0, 4) as string[]
      : DEFAULTS.suggestions,
    storeInfo: typeof data.store_info === "string" ? data.store_info : "",
    institutionalKb:
      typeof data.institutional_kb === "string" ? data.institutional_kb : "",
    askName: data.ask_name !== false,
    maxMessagesPerSession:
      Number(data.max_messages_per_session) > 0
        ? Number(data.max_messages_per_session)
        : DEFAULTS.maxMessagesPerSession,
    dailyMessageCap:
      Number(data.daily_message_cap) > 0
        ? Number(data.daily_message_cap)
        : DEFAULTS.dailyMessageCap,
    globalEnabled: data.global_enabled === true,
    globalWelcome:
      typeof data.global_welcome === "string" && data.global_welcome.trim()
        ? data.global_welcome
        : "Bem-vindo à Bulking. Sou seu assistente de compras: me diz o que você procura, ou toca numa sugestão aqui embaixo.",
    globalSuggestions: Array.isArray(data.global_suggestions)
      ? (data.global_suggestions as unknown[]).filter((s) => typeof s === "string").slice(0, 6) as string[]
      : [
          "Quero ajuda com meu tamanho",
          "O que tem de mais vendido?",
          "Quero camiseta para treinar",
          "Tem promoção hoje?",
        ],
  };
}

/** O produto da página atual está liberado para o assistente? */
export function isProductAllowed(
  settings: AssistantSettings,
  productId: string | null
): boolean {
  if (!settings.enabled) return false;
  if (settings.productIds.includes("*")) return true;
  if (!productId) return false;
  return settings.productIds.includes(String(productId));
}
