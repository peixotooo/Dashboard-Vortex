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
  format?: string;
  example?: { body_text?: string[][] };
  buttons?: Array<{ type: string; text: string; url?: string }>;
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
  const url = `https://graph.facebook.com/v18.0/${config.wabaId}/message_templates?limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Meta API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
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
      `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`,
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
