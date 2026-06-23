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

export interface WapiGroupInviteResult {
  inviteUrl: string | null;
  raw: unknown;
}

export interface WapiCreateGroupInput {
  groupName: string;
  participants: string[];
  profilePictureUrl?: string;
  autoInvite?: boolean;
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
      connected: false,
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
    const safeText = text.replaceAll(config.token, "[redacted]");
    throw new Error(`W-API ${res.status}: ${safeText.slice(0, 300)}`);
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
    const safeText = text.replaceAll(config.token, "[redacted]");
    throw new Error(`W-API ${res.status}: ${safeText.slice(0, 300)}`);
  }

  // image=enable retorna PNG binario - converter para data URI base64
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return { qrcode: `data:image/png;base64,${base64}` };
}

export async function listGroups(config: WapiConfig): Promise<unknown> {
  return wapiRequest(config, "/group/get-all-groups");
}

const WHATSAPP_INVITE_URL_RE =
  /https?:\/\/(?:chat\.whatsapp\.com|wa\.me\/joinchat)\/[^\s"'<>]+/i;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10,}$/;

function normalizeInviteCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const directUrl = trimmed.match(WHATSAPP_INVITE_URL_RE)?.[0];
  if (directUrl) return directUrl.replace(/[),.;]+$/, "");

  if (INVITE_CODE_RE.test(trimmed)) {
    return `https://chat.whatsapp.com/${trimmed}`;
  }

  return null;
}

export function extractInviteUrlFromResponse(raw: unknown): string | null {
  const seen = new Set<unknown>();
  const priorityKeys = new Set([
    "inviteLink",
    "inviteUrl",
    "invite_url",
    "groupInviteLink",
    "link",
    "url",
    "invite",
    "inviteCode",
    "code",
  ]);

  function visit(value: unknown): string | null {
    const direct = normalizeInviteCandidate(value);
    if (direct) return direct;

    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }

    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (!priorityKeys.has(key)) continue;
      const found = normalizeInviteCandidate(object[key]);
      if (found) return found;
    }

    for (const nested of Object.values(object)) {
      const found = visit(nested);
      if (found) return found;
    }

    return null;
  }

  return visit(raw);
}

export async function createGroup(
  config: WapiConfig,
  input: WapiCreateGroupInput
): Promise<{ groupId: string | null; inviteUrl: string | null; raw: unknown }> {
  const raw = await wapiRequest<Record<string, unknown>>(config, "/group/create-group", {
    method: "POST",
    body: {
      groupName: input.groupName,
      participants: input.participants,
      profilePictureUrl: input.profilePictureUrl || "",
      autoInvite: input.autoInvite ?? false,
    },
  });
  const group = (raw.group || {}) as Record<string, unknown>;
  return {
    groupId: (group.id as string) || (raw.groupId as string) || null,
    inviteUrl: extractInviteUrlFromResponse(raw),
    raw,
  };
}

export async function revokeGroupInvite(
  config: WapiConfig,
  groupId: string
): Promise<WapiGroupInviteResult> {
  const raw = await wapiRequest<unknown>(config, "/group/revoke-invite", {
    method: "POST",
    extraParams: { groupId },
  });

  return {
    inviteUrl: extractInviteUrlFromResponse(raw),
    raw,
  };
}

export interface WapiGroupMetadata {
  id: string;
  name: string;
  memberCount: number;
  adminsCount: number;
}

/**
 * Metadata de um grupo (contagem de membros incluida).
 * GET /group/group-metadata?instanceId=...&groupId=<jid>
 */
export async function getGroupMetadata(
  config: WapiConfig,
  groupId: string
): Promise<WapiGroupMetadata> {
  const raw = await wapiRequest<Record<string, unknown>>(
    config,
    "/group/group-metadata",
    { extraParams: { groupId } }
  );
  return extractGroupMetadata(raw, groupId);
}

export function extractGroupMetadata(
  raw: Record<string, unknown>,
  fallbackId: string
): WapiGroupMetadata {
  const g = ((raw?.group as Record<string, unknown>) || raw || {}) as Record<
    string,
    unknown
  >;
  const participants = Array.isArray(g.participants)
    ? (g.participants as Array<Record<string, unknown>>)
    : [];
  const size =
    typeof g.size === "number"
      ? (g.size as number)
      : typeof g.participantsCount === "number"
        ? (g.participantsCount as number)
        : participants.length;
  const adminsCount = participants.filter((p) => Boolean(p?.admin)).length;
  const name = (g.subject || g.name || g.groupName || "") as string;

  return {
    id: (g.id as string) || fallbackId,
    name,
    memberCount: size,
    adminsCount,
  };
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
    const safeText = text.replaceAll(config.token, "[redacted]");
    return {
      healthy: false,
      reason: `Sessao W-API em estado inconsistente (${res.status} em /group/get-all-groups: ${safeText.slice(0, 180)}). Use 'Reiniciar instancia' ou reconecte antes de enviar para evitar disparo em massa quando a sessao voltar.`,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const safeText = text.replaceAll(config.token, "[redacted]");
    return {
      healthy: false,
      reason: `W-API rejeitou validacao de sessao (${res.status}): ${safeText.slice(0, 180)}`,
    };
  }

  return { healthy: true };
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
