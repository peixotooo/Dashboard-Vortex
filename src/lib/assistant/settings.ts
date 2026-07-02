import { createAdminClient } from "@/lib/supabase-admin";
import type { AssistantSettings } from "./types";

const DEFAULTS = {
  title: "Assistente Bulking",
  welcomeMessage:
    "Fala! Sou o assistente da loja. Posso te ajudar com tamanho, tecido, disponibilidade e recomendações. O que você precisa?",
  suggestions: [
    "Qual tamanho ideal pra mim?",
    "Esse tecido é dry ou algodão?",
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
      askName: true,
      maxMessagesPerSession: DEFAULTS.maxMessagesPerSession,
      dailyMessageCap: DEFAULTS.dailyMessageCap,
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
    welcomeMessage: data.welcome_message || DEFAULTS.welcomeMessage,
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
