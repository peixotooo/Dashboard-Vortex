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
  request_delay_days: number;
  request_ask_media: boolean;
  request_reminder_days: number | null;
  request_message_template: string | null;
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
  request_delay_days: 7,
  request_ask_media: true,
  request_reminder_days: null,
  request_message_template:
    "Oi {nome}! Você comprou {produto} com a gente 💛 Conta pra gente o que achou? Sua avaliação (com foto ou vídeo!) ajuda muita gente: {link}",
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
  "request_ask_media",
  "request_reminder_days",
  "request_message_template",
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
