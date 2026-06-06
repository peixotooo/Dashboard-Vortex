import { createAdminClient } from "@/lib/supabase-admin";

// Config do widget de avaliações + da régua de comunicação (1 linha por
// workspace em review_settings). Server-only via admin client.

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
  request_reminder_days: number | null;
  request_message_template: string | null;
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
  request_reminder_days: null,
  request_message_template:
    "Oi {nome}, tudo bem? 💛 Sua {produto} já chegou? Conta pra gente o que achou — leva 1 minutinho e ajuda muita gente a comprar com confiança. Pode mandar foto ou vídeo também! 👉 {link}",
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
  "request_message_template",
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
  return data as ReviewSettings;
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

  const { data, error } = await admin
    .from("review_settings")
    .upsert(clean, { onConflict: "workspace_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as ReviewSettings;
}
