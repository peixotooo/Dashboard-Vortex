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

export async function sendText(
  config: WapiConfig,
  phone: string,
  message: string,
  delayMessage = 1
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-text", {
    method: "POST",
    body: { phone, message, delayMessage },
  });
}

export async function sendImage(
  config: WapiConfig,
  phone: string,
  image: string,
  caption?: string,
  delayMessage = 1
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-image", {
    method: "POST",
    body: { phone, image, caption, delayMessage },
  });
}

export async function sendVideo(
  config: WapiConfig,
  phone: string,
  video: string,
  caption?: string,
  delayMessage = 1
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-video", {
    method: "POST",
    body: { phone, video, caption, delayMessage },
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
  delayMessage = 1
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-document", {
    method: "POST",
    body: { phone, document, extension, fileName, caption, delayMessage },
  });
}
