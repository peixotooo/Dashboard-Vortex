import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";

// --- Types ---

export interface WapiConfig {
  instanceId: string;
  token: string;
  connected: boolean;
}

export interface WapiGroup {
  id: string;
  name: string;
  description?: string;
  participants?: number;
}

export interface WapiSendResult {
  instanceId?: string;
  messageId?: string;
  insertedId?: string;
  error?: string;
}

export type WapiMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document";

// --- Config CRUD ---

export async function getWapiConfig(
  workspaceId: string
): Promise<WapiConfig | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wapi_config")
    .select("instance_id, token, connected")
    .eq("workspace_id", workspaceId)
    .single();

  if (!data?.instance_id || !data?.token) return null;

  return {
    instanceId: data.instance_id,
    token: decrypt(data.token),
    connected: data.connected ?? false,
  };
}

export async function saveWapiConfig(
  workspaceId: string,
  config: { instanceId: string; token: string }
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("wapi_config").upsert(
    {
      workspace_id: workspaceId,
      instance_id: config.instanceId,
      token: encrypt(config.token),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );

  if (error) throw new Error(`Failed to save W-API config: ${error.message}`);
}

export async function updateWapiConnected(
  workspaceId: string,
  connected: boolean
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("wapi_config")
    .update({ connected, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);
}

// --- W-API HTTP helper ---

async function wapiRequest<T>(
  config: WapiConfig,
  path: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    extraParams?: Record<string, string>;
  }
): Promise<T> {
  const params = new URLSearchParams({ instanceId: config.instanceId });
  if (options?.extraParams) {
    for (const [k, v] of Object.entries(options.extraParams)) {
      params.set(k, v);
    }
  }

  const url = `https://api.w-api.app/v1${path}?${params.toString()}`;
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`W-API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// --- Endpoint wrappers ---

export async function getInstanceStatus(
  config: WapiConfig
): Promise<{ instanceId: string; connected: boolean }> {
  return wapiRequest(config, "/instance/status-instance");
}

export async function getQrCode(
  config: WapiConfig
): Promise<{ qrcode: string }> {
  const params = new URLSearchParams({
    instanceId: config.instanceId,
    image: "enable",
  });
  const url = `https://api.w-api.app/v1/instance/qr-code?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`W-API ${res.status}: ${text.slice(0, 300)}`);
  }

  // image=enable retorna PNG binario - converter para data URI base64
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { qrcode: `data:image/png;base64,${base64}` };
}

export async function listGroups(config: WapiConfig): Promise<unknown> {
  return wapiRequest(config, "/group/get-all-groups");
}

export async function disconnectInstance(
  config: WapiConfig
): Promise<{ error?: boolean; message?: string; instanceId?: string }> {
  return wapiRequest(config, "/instance/disconnect");
}

export async function restartInstance(
  config: WapiConfig
): Promise<{ error?: boolean; message?: string }> {
  return wapiRequest(config, "/instance/restart");
}

/**
 * Pre-flight health check before dispatching messages.
 *
 * The W-API session can be in a half-broken state where
 * /instance/status-instance reports `connected: true` but the underlying
 * WhatsApp Web socket is dead — in that mode /message/send-text still
 * returns 200 with a messageId, but messages are queued internally and
 * fired in a single burst when the session is restored.
 *
 * We probe /group/get-all-groups as a canary: when the session is
 * broken, that endpoint returns 500 with
 * `Cannot read properties of undefined (reading 'instance')`. If status
 * is connected AND the canary returns 2xx, the session is genuinely
 * usable and it is safe to dispatch.
 */
export async function checkInstanceHealth(
  config: WapiConfig
): Promise<{ healthy: boolean; reason?: string }> {
  // 1) status check — must be connected
  let status: { connected?: boolean } | null = null;
  try {
    status = await wapiRequest<{ connected?: boolean }>(
      config,
      "/instance/status-instance"
    );
  } catch (err) {
    return {
      healthy: false,
      reason: `Falha ao consultar status da instancia: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!status?.connected) {
    return {
      healthy: false,
      reason:
        "Instancia W-API nao esta conectada. Reconecte (escaneando o QR Code) antes de enviar.",
    };
  }

  // 2) canary — group list endpoint must work. If it returns 500 with the
  //    "instance undefined" signature, the WhatsApp Web layer is broken
  //    and any message we send will queue without delivery, then burst on
  //    reconnect.
  const params = new URLSearchParams({ instanceId: config.instanceId });
  const url = `https://api.w-api.app/v1/group/get-all-groups?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return {
      healthy: false,
      reason: `Falha de rede ao validar sessao: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (res.status >= 500) {
    const text = await res.text().catch(() => "");
    return {
      healthy: false,
      reason: `Sessao W-API em estado inconsistente (${res.status} em /group/get-all-groups: ${text.slice(0, 180)}). Use 'Reiniciar instancia' ou reconecte antes de enviar para evitar disparo em massa quando a sessao voltar.`,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      healthy: false,
      reason: `W-API rejeitou validacao de sessao (${res.status}): ${text.slice(0, 180)}`,
    };
  }

  return { healthy: true };
}

export interface SendOptions {
  /**
   * List of phone numbers (digits only, no + or @) to mention in the message.
   * Internally we send the field under several common aliases (`mentioned`,
   * `mentions`, `mentionedJidList`) so the call works regardless of which
   * one the W-API build accepts — extra unknown fields are ignored server
   * side. The text itself must already include `@<phone>` tokens for the
   * mention to render in WhatsApp.
   */
  mentioned?: string[];
}

function withMentions(
  body: Record<string, unknown>,
  opts?: SendOptions
): Record<string, unknown> {
  if (!opts?.mentioned || opts.mentioned.length === 0) return body;
  const phones = opts.mentioned;
  const jids = phones.map((p) => `${p}@s.whatsapp.net`);
  return {
    ...body,
    mentioned: phones,
    mentions: jids,
    mentionedJidList: jids,
  };
}

export async function sendText(
  config: WapiConfig,
  phone: string,
  message: string,
  delayMessage = 1,
  opts?: SendOptions
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-text", {
    method: "POST",
    body: withMentions({ phone, message, delayMessage }, opts),
  });
}

export async function sendImage(
  config: WapiConfig,
  phone: string,
  image: string,
  caption?: string,
  delayMessage = 1,
  opts?: SendOptions
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-image", {
    method: "POST",
    body: withMentions({ phone, image, caption, delayMessage }, opts),
  });
}

export async function sendVideo(
  config: WapiConfig,
  phone: string,
  video: string,
  caption?: string,
  delayMessage = 1,
  opts?: SendOptions
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-video", {
    method: "POST",
    body: withMentions({ phone, video, caption, delayMessage }, opts),
  });
}

export async function sendAudio(
  config: WapiConfig,
  phone: string,
  audio: string,
  delayMessage = 1
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-audio", {
    method: "POST",
    body: { phone, audio, delayMessage },
  });
}

export async function sendDocument(
  config: WapiConfig,
  phone: string,
  document: string,
  extension: string,
  fileName?: string,
  caption?: string,
  delayMessage = 1,
  opts?: SendOptions
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-document", {
    method: "POST",
    body: withMentions(
      { phone, document, extension, fileName, caption, delayMessage },
      opts
    ),
  });
}

// --- Group participants (for mention-all) ---

export interface WapiParticipant {
  id: string; // e.g. "37885956890738@lid" or "55...@s.whatsapp.net"
  phoneNumber?: string; // e.g. "556285955001@s.whatsapp.net" (when LID-mapped)
  admin?: "admin" | "superadmin" | null;
}

export async function getGroupParticipants(
  config: WapiConfig,
  groupId: string
): Promise<WapiParticipant[]> {
  const result = await wapiRequest<{
    error?: boolean;
    participants?: WapiParticipant[];
  }>(config, "/group/get-Participants", {
    extraParams: { groupId },
  });
  return result.participants || [];
}

/**
 * Returns the bare phone number (digits only) for a participant, preferring
 * the `phoneNumber` field which W-API populates for LID-mapped accounts.
 * Falls back to parsing the `id`. Returns null if neither resolves to a
 * regular phone (e.g. pure @lid with no phoneNumber mapping).
 */
export function participantPhone(p: WapiParticipant): string | null {
  const candidate = p.phoneNumber || p.id || "";
  // strip @s.whatsapp.net / @lid / @c.us suffixes and non-digits
  const at = candidate.indexOf("@");
  const left = at >= 0 ? candidate.slice(0, at) : candidate;
  const suffix = at >= 0 ? candidate.slice(at + 1) : "";
  // @lid ids are not real phone numbers; only accept if we have @s.whatsapp.net
  if (suffix && suffix !== "s.whatsapp.net" && suffix !== "c.us") {
    return null;
  }
  const digits = left.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}
