import { createAdminClient } from "@/lib/supabase-admin";
import type { EmailTemplateSettings } from "./types";

const DEFAULTS: Omit<EmailTemplateSettings, "workspace_id"> = {
  enabled: false,
  // 90 days = "real bestseller" rather than week's tendency. The
  // multi-component score in pickBestseller (volume + revenue +
  // momentum + freshness + stock) brings 48h momentum back as a
  // separate signal so we don't lose right-now-trending products.
  bestseller_lookback_days: 90,
  slowmoving_lookback_days: 30,
  newarrival_lookback_days: 14,
  min_stock_bestseller: 5,
  slowmoving_max_sales: 3,
  slowmoving_discount_percent: 10,
  slowmoving_coupon_validity_hours: 48,
  copy_provider: "template",
  llm_agent_slug: null,
  // Variant attribute label mapping. VNDA's BR fashion catalogs almost
  // always put color in attribute1 and size in attribute2; if a tenant
  // breaks the convention they can flip the labels via settings. Null
  // means "ignore this attribute" — the column is still preserved in
  // crm_vendas.items, just not aggregated into preferredColors etc.
  attribute1_label: "cor",
  attribute2_label: "tamanho",
  // Anti-repetition tunables (Frente C). Defaults are conservative —
  // they preserve current behavior unless a workspace opts in. The
  // picker will read these and adjust scoring + exploration accordingly.
  category_penalty_weight: 0.5,
  exploration_rate: 0.15,
  auto_relax_threshold: 0.3,
  // Bestseller scoring tunables (Frente B). 48h momentum window catches
  // "right now" trends; revenue weight of 0.25 lets a high-ticket item
  // win against a slightly higher-volume cheap one. crm_validation
  // defaults true — cheap to opt out when GA4 is the only source.
  momentum_window_hours: 48,
  bestseller_revenue_weight: 0.25,
  crm_validation_enabled: true,
};

export function getDefaults(workspace_id: string): EmailTemplateSettings {
  return { workspace_id, ...DEFAULTS };
}

export async function getSettings(
  workspace_id: string
): Promise<EmailTemplateSettings> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_settings")
    .select("*")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (!data) return getDefaults(workspace_id);
  return data as EmailTemplateSettings;
}

export async function upsertSettings(
  patch: Partial<EmailTemplateSettings> & { workspace_id: string }
): Promise<EmailTemplateSettings> {
  // Range checks
  if (patch.slowmoving_discount_percent !== undefined) {
    if (patch.slowmoving_discount_percent < 5 || patch.slowmoving_discount_percent > 20) {
      throw new Error("slowmoving_discount_percent must be between 5 and 20");
    }
  }
  if (patch.slowmoving_coupon_validity_hours !== undefined) {
    if (patch.slowmoving_coupon_validity_hours < 12 || patch.slowmoving_coupon_validity_hours > 168) {
      throw new Error("slowmoving_coupon_validity_hours must be between 12 and 168");
    }
  }
  for (const key of [
    "bestseller_lookback_days",
    "slowmoving_lookback_days",
    "newarrival_lookback_days",
  ] as const) {
    const v = patch[key];
    if (v !== undefined && (v < 1 || v > 90)) {
      throw new Error(`${key} must be between 1 and 90`);
    }
  }
  if (patch.slowmoving_max_sales !== undefined) {
    if (patch.slowmoving_max_sales < 0 || patch.slowmoving_max_sales > 50) {
      throw new Error("slowmoving_max_sales must be between 0 and 50");
    }
  }

  const supabase = createAdminClient();
  const existing = await getSettings(patch.workspace_id);
  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("email_template_settings")
    .upsert(merged, { onConflict: "workspace_id" })
    .select()
    .single();
  if (error) throw error;
  return data as EmailTemplateSettings;
}

export async function listEnabledWorkspaces(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_settings")
    .select("workspace_id")
    .eq("enabled", true);
  return (data ?? []).map((r) => r.workspace_id as string);
}
