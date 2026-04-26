import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";

// --- Types ---

export interface WaConfig {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  displayPhone?: string;
}

export interface WaTemplateComponent {
  type: string; // HEADER, BODY, FOOTER, BUTTONS
  text?: string;
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT (HEADER only)
  example?: {
    body_text?: string[][];
    header_text?: string[];
    header_url?: string[];
  };
  buttons?: Array<{
    type: string;
    text: string;
    url?: string;
    phone_number?: string;
    example?: string[];
  }>;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: WaTemplateComponent[];
}

export interface WaSendResult {
  messageId: string | null;
  error: string | null;
}

// --- Config helpers ---

export async function getWaConfig(workspaceId: string): Promise<WaConfig | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wa_config")
    .select("phone_number_id, waba_id, access_token, display_phone")
    .eq("workspace_id", workspaceId)
    .single();

  if (!data?.phone_number_id || !data?.access_token) return null;

  return {
    phoneNumberId: data.phone_number_id,
    wabaId: data.waba_id,
    accessToken: decrypt(data.access_token),
    displayPhone: data.display_phone || undefined,
  };
}

export async function saveWaConfig(
  workspaceId: string,
  config: { phoneNumberId: string; wabaId: string; accessToken: string; displayPhone?: string }
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("wa_config")
    .upsert(
      {
        workspace_id: workspaceId,
        phone_number_id: config.phoneNumberId,
        waba_id: config.wabaId,
        access_token: encrypt(config.accessToken),
        display_phone: config.displayPhone || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

  if (error) throw new Error(`Failed to save WA config: ${error.message}`);
}

// --- Template sync ---

export async function syncTemplatesFromMeta(config: WaConfig): Promise<WaTemplate[]> {
  const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates?limit=100`;
  console.error(`[WA Sync] Fetching: ${url.replace(config.accessToken, "***")}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WA Sync] Meta error ${res.status}: ${text.slice(0, 300)}`);
    throw new Error(`Meta API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  console.error(`[WA Sync] Meta returned ${(json.data || []).length} templates, keys: ${Object.keys(json).join(",")}`);

  const templates: WaTemplate[] = (json.data || []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    language: t.language as string,
    category: t.category as string,
    status: t.status as string,
    components: (t.components || []) as WaTemplateComponent[],
  }));

  return templates;
}

// --- Single-template fetch (for category re-verification) ---
//
// Meta periodically reclassifies templates (UTILITY/AUTHENTICATION → MARKETING),
// which changes the per-message price. Call this before dispatch to detect drift.
export async function fetchTemplateFromMeta(
  config: WaConfig,
  metaTemplateId: string
): Promise<{ id: string; name: string; language: string; category: string; status: string; components: WaTemplateComponent[] } | null> {
  const url = `https://graph.facebook.com/v21.0/${metaTemplateId}?fields=id,name,language,category,status,components`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WA Recheck] Meta error ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }

  const t = await res.json();
  return {
    id: t.id as string,
    name: t.name as string,
    language: t.language as string,
    category: t.category as string,
    status: t.status as string,
    components: (t.components || []) as WaTemplateComponent[],
  };
}

export interface TemplateRecheckResult {
  ok: boolean;
  changed: boolean;
  previousCategory: string | null;
  currentCategory: string | null;
  previousStatus: string | null;
  currentStatus: string | null;
  reason?: string;
}

// Re-fetch a template from Meta and persist any category/status change to wa_templates.
// Returns whether the category drifted — callers can decide to pause/warn on MARKETING reclass.
export async function recheckTemplateOnMeta(
  workspaceId: string,
  templateRowId: string
): Promise<TemplateRecheckResult> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("wa_templates")
    .select("meta_id, category, status")
    .eq("id", templateRowId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!row?.meta_id) {
    return {
      ok: false,
      changed: false,
      previousCategory: row?.category ?? null,
      currentCategory: null,
      previousStatus: row?.status ?? null,
      currentStatus: null,
      reason: "missing_meta_id",
    };
  }

  const config = await getWaConfig(workspaceId);
  if (!config) {
    return {
      ok: false,
      changed: false,
      previousCategory: row.category,
      currentCategory: null,
      previousStatus: row.status,
      currentStatus: null,
      reason: "no_wa_config",
    };
  }

  const live = await fetchTemplateFromMeta(config, row.meta_id);
  if (!live) {
    return {
      ok: false,
      changed: false,
      previousCategory: row.category,
      currentCategory: null,
      previousStatus: row.status,
      currentStatus: null,
      reason: "meta_fetch_failed",
    };
  }

  const changed = live.category !== row.category || live.status !== row.status;
  if (changed) {
    await admin
      .from("wa_templates")
      .update({
        category: live.category,
        status: live.status,
        components: live.components,
        synced_at: new Date().toISOString(),
      })
      .eq("id", templateRowId);
  } else {
    await admin
      .from("wa_templates")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", templateRowId);
  }

  return {
    ok: true,
    changed,
    previousCategory: row.category,
    currentCategory: live.category,
    previousStatus: row.status,
    currentStatus: live.status,
  };
}

// --- Send message ---

export async function sendTemplateMessage(
  config: WaConfig,
  phone: string,
  templateName: string,
  language: string,
  variables?: Record<string, string>
): Promise<WaSendResult> {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(variables && Object.keys(variables).length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: Object.values(variables).map((val) => ({
                  type: "text",
                  text: val,
                })),
              },
            ],
          }
        : {}),
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { messageId: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = await res.json();
    const messageId = json.messages?.[0]?.id || null;
    return { messageId, error: null };
  } catch (err) {
    return {
      messageId: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// --- Template management ---

export async function createTemplateOnMeta(
  config: WaConfig,
  payload: {
    name: string;
    language: string;
    category: string;
    components: Record<string, unknown>[];
  }
): Promise<{ id: string; status: string; category: string }> {
  const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || detail;
    } catch {}
    throw new Error(`Meta API ${res.status}: ${detail}`);
  }

  return res.json();
}

export async function deleteTemplateOnMeta(
  config: WaConfig,
  templateName: string
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || detail;
    } catch {}
    throw new Error(`Meta API ${res.status}: ${detail}`);
  }
}

// --- Parse template variables ---

export function extractTemplateVariables(components: WaTemplateComponent[]): string[] {
  const vars: string[] = [];
  for (const comp of components) {
    if (comp.text) {
      const matches = comp.text.match(/\{\{(\d+)\}\}/g);
      if (matches) {
        for (const m of matches) {
          if (!vars.includes(m)) vars.push(m);
        }
      }
    }
  }
  return vars.sort();
}

export function getTemplateBodyText(components: WaTemplateComponent[]): string {
  const body = components.find((c) => c.type === "BODY");
  return body?.text || "";
}
