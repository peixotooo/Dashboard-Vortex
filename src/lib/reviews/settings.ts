import { createAdminClient } from "@/lib/supabase-admin";

// Config do widget de avaliações + da régua de comunicação (1 linha por
// workspace em review_settings). Server-only via admin client.

export interface ReviewFormField {
  key: string;
  label: string;
  type: "select" | "text";
  options: string[];
}

// Campos padrão do formulário de avaliação (marca fitness/Bulking). O cliente
// seleciona e isso vira custom_fields exibido na avaliação.
export const DEFAULT_FORM_FIELDS: ReviewFormField[] = [
  { key: "tamanho_comprado", label: "Tamanho comprado", type: "select", options: ["PP", "P", "M", "G", "GG", "XGG"] },
  { key: "tamanho_usual", label: "Tamanho que costumo usar", type: "select", options: ["PP", "P", "M", "G", "GG", "XGG"] },
  { key: "caimento", label: "Caimento", type: "select", options: ["Justo", "Perfeito", "Folgado"] },
  { key: "altura", label: "Altura", type: "select", options: ["até 1,65m", "1,66m - 1,75m", "1,76m - 1,85m", "acima de 1,85m"] },
  { key: "tipo_corpo", label: "Tipo de corpo", type: "select", options: ["Magro", "Atlético", "Musculoso", "Forte", "Plus"] },
  { key: "atividade", label: "Atividade principal", type: "select", options: ["Musculação", "Crossfit", "Corrida", "Funcional", "Outro"] },
  { key: "frequencia", label: "Frequência de treino", type: "select", options: ["1-2x por semana", "3-4x por semana", "5-6x por semana", "todo dia"] },
  { key: "idade", label: "Idade", type: "select", options: ["18-24", "25-34", "35-44", "45+"] },
];

export interface ReviewSettings {
  workspace_id: string;
  widget_enabled: boolean;
  accent_color: string;
  star_color: string;
  anchor_selector: string | null;
  show_verified_badge: boolean;
  show_custom_fields: boolean;
  reviews_per_page: number;
  auto_publish: boolean;
  request_enabled: boolean;
  request_channel: "whatsapp" | "email";
  request_trigger: "purchase" | "delivery";
  request_delay_days: number;              // mínimo de dias após a COMPRA confirmada
  request_require_invoice: boolean;        // só após o pedido ser enviado (proxy de faturado)
  request_days_after_invoice: number;      // dias após o envio/faturamento (shipped_at)
  request_ask_media: boolean;
  request_reminder_days: number | null;     // 1º lembrete (dias após o 1º contato)
  request_reminder_2_days: number | null;   // 2º lembrete (dias após o 1º lembrete)
  // Mensagens por etapa (substância, sem saudação — {produto} e {link}).
  request_message_template: string | null;      // 1º contato (pedido)
  request_reminder_message: string | null;      // 1º lembrete
  request_reminder_2_message: string | null;    // 2º lembrete
  collect_store_review: boolean;            // coletar avaliação da loja na landing
  form_fields: ReviewFormField[];           // campos estruturados do formulário
  // WhatsApp template (categoria UTILITY) usado na régua
  wa_template_id: string | null;
  wa_variable_mapping: Record<string, string>;
  // Gamificação / recompensas (cashback por tier)
  rewards_enabled: boolean;
  reward_photo_amount: number;
  reward_video_amount: number;
  reward_video_ads_amount: number;
  reward_validity_days: number;
  ads_enabled: boolean;                    // pedir consentimento de uso em ADS para vídeos
}

export const DEFAULT_REVIEW_SETTINGS: Omit<ReviewSettings, "workspace_id"> = {
  widget_enabled: true,
  accent_color: "#e6b800",
  star_color: "#e6b800",
  anchor_selector: null,
  show_verified_badge: true,
  show_custom_fields: true,
  reviews_per_page: 10,
  auto_publish: false,
  request_enabled: false,
  request_channel: "whatsapp",
  request_trigger: "purchase",
  request_delay_days: 15,
  request_require_invoice: true,
  request_days_after_invoice: 9,
  request_ask_media: true,
  request_reminder_days: 4,
  request_reminder_2_days: 5,
  collect_store_review: true,
  form_fields: DEFAULT_FORM_FIELDS,
  request_message_template:
    "Sua {produto} já chegou? Conta como ficou no corpo e no treino. Se puder, mande uma foto da peça vestida ou um vídeo curto — é isso que mais ajuda outras pessoas a escolherem certo. Avalie aqui: {link}",
  request_reminder_message:
    "Passando pra lembrar da {produto}: uma foto ou vídeo real vale muito pra quem está em dúvida de tamanho, tecido e caimento. Leva 1 minuto: {link}",
  request_reminder_2_message:
    "Último lembrete sobre a {produto}. Se ela funcionou bem pra você, mostra pra comunidade com foto ou vídeo e ganhe 1 cashback na avaliação aprovada: {link}",
  wa_template_id: null,
  wa_variable_mapping: {},
  rewards_enabled: false,
  reward_photo_amount: 10,
  reward_video_amount: 30,
  reward_video_ads_amount: 50,
  reward_validity_days: 60,
  ads_enabled: true,
};

// Campos editáveis pelo admin (whitelist contra mass-assignment).
const EDITABLE: (keyof Omit<ReviewSettings, "workspace_id">)[] = [
  "widget_enabled",
  "accent_color",
  "star_color",
  "anchor_selector",
  "show_verified_badge",
  "show_custom_fields",
  "reviews_per_page",
  "auto_publish",
  "request_enabled",
  "request_channel",
  "request_trigger",
  "request_delay_days",
  "request_require_invoice",
  "request_days_after_invoice",
  "request_ask_media",
  "request_reminder_days",
  "request_reminder_2_days",
  "collect_store_review",
  "form_fields",
  "request_message_template",
  "request_reminder_message",
  "request_reminder_2_message",
  "wa_variable_mapping",
  "rewards_enabled",
  "reward_photo_amount",
  "reward_video_amount",
  "reward_video_ads_amount",
  "reward_validity_days",
  "ads_enabled",
];

export async function getReviewSettings(workspaceId: string): Promise<ReviewSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) {
    return { workspace_id: workspaceId, ...DEFAULT_REVIEW_SETTINGS };
  }
  const row = data as ReviewSettings;
  // Mensagens da régua: null = "usar a copy padrão". Coalesce pra que o admin
  // mostre exatamente o que será enviado (e o ruler já usa o mesmo fallback).
  return {
    ...row,
    request_message_template: row.request_message_template ?? DEFAULT_REVIEW_SETTINGS.request_message_template,
    request_reminder_message: row.request_reminder_message ?? DEFAULT_REVIEW_SETTINGS.request_reminder_message,
    request_reminder_2_message: row.request_reminder_2_message ?? DEFAULT_REVIEW_SETTINGS.request_reminder_2_message,
    form_fields: row.form_fields ?? DEFAULT_FORM_FIELDS,
  };
}

export async function upsertReviewSettings(
  workspaceId: string,
  patch: Partial<ReviewSettings>
): Promise<ReviewSettings> {
  const admin = createAdminClient();

  const clean: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (key in patch && patch[key] !== undefined) clean[key] = patch[key];
  }
  clean.workspace_id = workspaceId;
  clean.updated_at = new Date().toISOString();

  async function save(payload: Record<string, unknown>) {
    return admin
      .from("review_settings")
      .upsert(payload, { onConflict: "workspace_id" })
      .select("*")
      .single();
  }

  let { data, error } = await save(clean);

  // Produção pode estar um passo atrás da migration 113. Se a coluna ainda não
  // existe, não podemos deixar o save inteiro falhar e perder request_enabled /
  // copies da régua. O formulário cai no default do código até a migration rodar.
  if (error && error.code === "PGRST204" && error.message.includes("'form_fields'")) {
    delete clean.form_fields;
    const retry = await save(clean);
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(error.message);
  return {
    ...(data as ReviewSettings),
    form_fields: (data as ReviewSettings).form_fields ?? DEFAULT_FORM_FIELDS,
  };
}
