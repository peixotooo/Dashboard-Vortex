import { createAdminClient } from "@/lib/supabase-admin";
import type { EmailTemplateSettings } from "./types";

const DEFAULTS: Omit<EmailTemplateSettings, "workspace_id"> = {
  enabled: false,
  bestseller_lookback_days: 7,
  slowmoving_lookback_days: 30,
  newarrival_lookback_days: 14,
  min_stock_bestseller: 5,
  slowmoving_max_sales: 3,
  slowmoving_discount_percent: 10,
  slowmoving_coupon_validity_hours: 48,
  copy_provider: "template",
  llm_agent_slug: null,
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
  // Enforce ranges
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

  const supabase = createAdminClient();
  const merged = { ...getDefaults(patch.workspace_id), ...patch, updated_at: new Date().toISOString() };
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
