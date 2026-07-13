import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";
import type {
  WapiMessagePayload,
  WapiMessageType,
} from "@/lib/whatsapp/wapi-message-types";
import { toWapiWirePayload } from "@/lib/whatsapp/wapi-message-types";

export type { WapiMessageType } from "@/lib/whatsapp/wapi-message-types";

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

// --- Config CRUD ---

export async function getWapiConfig(
  workspaceId: string,
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
  config: { instanceId: string; token: string },
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
    { onConflict: "workspace_id" },
  );

  if (error) throw new Error(`Failed to save W-API config: ${error.message}`);
}

export async function updateWapiConnected(
  workspaceId: string,
  connected: boolean,
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
  },
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
  config: WapiConfig,
): Promise<{ instanceId: string; connected: boolean }> {
  return wapiRequest(config, "/instance/status-instance");
}

export async function getQrCode(
  config: WapiConfig,
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

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value.trim().replace(",", ".");
  if (!cleaned) return null;

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function firstNonEmptyString(
  records: AnyRecord[],
  keys: string[],
): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
  }
  return null;
}

function collectRecordCandidates(raw: unknown): AnyRecord[] {
  const out: AnyRecord[] = [];
  const seen = new Set<unknown>();
  const priorityKeys = [
    "group",
    "data",
    "result",
    "metadata",
    "groupMetadata",
    "group_metadata",
    "response",
  ];

  function add(value: unknown, depth = 0) {
    if (!isRecord(value) || seen.has(value) || depth > 3) return;
    seen.add(value);
    out.push(value);

    for (const key of priorityKeys) {
      add(value[key], depth + 1);
    }
  }

  add(raw);
  return out;
}

function groupRecordScore(record: AnyRecord): number {
  const countKeys = [
    "size",
    "participantsCount",
    "participantCount",
    "participants_count",
    "memberCount",
    "membersCount",
    "member_count",
    "members_count",
    "totalParticipants",
    "totalMembers",
    "total",
    "count",
  ];
  const participantKeys = ["participants", "members", "users"];
  const nameKeys = ["subject", "name", "groupName", "title"];
  const idKeys = ["id", "jid", "groupId", "groupJid", "remoteJid", "_id"];

  let score = 0;
  if (countKeys.some((key) => record[key] != null)) score += 5;
  if (participantKeys.some((key) => record[key] != null)) score += 4;
  if (nameKeys.some((key) => record[key] != null)) score += 2;
  if (idKeys.some((key) => record[key] != null)) score += 1;
  return score;
}

function rankedGroupRecords(raw: unknown): AnyRecord[] {
  return collectRecordCandidates(raw).sort(
    (a, b) => groupRecordScore(b) - groupRecordScore(a),
  );
}

function getArrayLikeValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return [];
}

function firstArrayLike(records: AnyRecord[], keys: string[]): unknown[] {
  for (const record of records) {
    for (const key of keys) {
      const values = getArrayLikeValues(record[key]);
      if (values.length > 0) return values;
    }
  }
  return [];
}

function findFirstNumber(records: AnyRecord[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const number = toFiniteNumber(record[key]);
      if (number != null) return number;
    }
  }
  return null;
}

export function normalizeWapiGroups(raw: unknown): WapiGroup[] {
  const arrays: unknown[][] = [];

  if (Array.isArray(raw)) arrays.push(raw);

  for (const record of collectRecordCandidates(raw)) {
    for (const key of ["groups", "data", "result", "items", "list"]) {
      const value = record[key];
      if (Array.isArray(value)) arrays.push(value);
      if (isRecord(value)) {
        for (const nestedKey of ["groups", "items", "list"]) {
          const nested = value[nestedKey];
          if (Array.isArray(nested)) arrays.push(nested);
        }
      }
    }
  }

  const seen = new Set<string>();
  const groups: WapiGroup[] = [];
  for (const source of arrays) {
    for (const item of source) {
      if (!isRecord(item)) continue;
      const candidates = rankedGroupRecords(item);
      const id = firstNonEmptyString(candidates, [
        "id",
        "jid",
        "groupId",
        "groupJid",
        "remoteJid",
        "_id",
      ]);
      if (!id || !id.includes("@g.us") || seen.has(id)) continue;

      const name =
        firstNonEmptyString(candidates, [
          "name",
          "subject",
          "groupName",
          "title",
        ]) || "Sem nome";
      const participants = findFirstNumber(candidates, [
        "size",
        "participantsCount",
        "participantCount",
        "participants_count",
        "memberCount",
        "membersCount",
        "member_count",
        "members_count",
      ]);

      seen.add(id);
      groups.push({
        id,
        name,
        ...(participants != null ? { participants } : {}),
      });
    }
  }

  return groups;
}

export function isWapiDisconnectedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /whatsapp\s+n[aã]o\s+conectado|not\s+connected|disconnected/i.test(
    message,
  );
}

const WHATSAPP_INVITE_URL_RE =
  /https?:\/\/(?:chat\.whatsapp\.com|wa\.me\/joinchat)\/[^\s"'<>]+/i;
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10,}$/;
const INVALID_INVITE_CODES = new Set([
  "undefined",
  "null",
  "false",
  "true",
  "nan",
  "[objectobject]",
]);

function normalizeInviteCode(value: string): string | null {
  const code = value.trim().replace(/[),.;]+$/, "");
  const normalized = code.toLowerCase().replace(/\s+/g, "");
  if (!code || INVALID_INVITE_CODES.has(normalized)) return null;
  return INVITE_CODE_RE.test(code) ? code : null;
}

function normalizeInviteUrl(value: string): string | null {
  const trimmed = value.trim();
  const directUrl = trimmed.match(WHATSAPP_INVITE_URL_RE)?.[0];
  if (!directUrl) return null;

  try {
    const url = new URL(directUrl.replace(/[),.;]+$/, ""));
    const parts = url.pathname.split("/").filter(Boolean);
    const code = normalizeInviteCode(parts[parts.length - 1] || "");
    if (!code) return null;

    if (url.hostname === "chat.whatsapp.com") {
      return `https://chat.whatsapp.com/${code}`;
    }
    if (url.hostname === "wa.me" && parts[0] === "joinchat") {
      return `https://wa.me/joinchat/${code}`;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeInviteCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const directUrl = normalizeInviteUrl(trimmed);
  if (directUrl) return directUrl;

  const code = normalizeInviteCode(trimmed);
  if (code) {
    return `https://chat.whatsapp.com/${code}`;
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
  input: WapiCreateGroupInput,
): Promise<{ groupId: string | null; inviteUrl: string | null; raw: unknown }> {
  const raw = await wapiRequest<Record<string, unknown>>(
    config,
    "/group/create-group",
    {
      method: "POST",
      body: {
        groupName: input.groupName,
        participants: input.participants,
        profilePictureUrl: input.profilePictureUrl || "",
        autoInvite: input.autoInvite ?? false,
      },
    },
  );
  const group = (raw.group || {}) as Record<string, unknown>;
  return {
    groupId: (group.id as string) || (raw.groupId as string) || null,
    inviteUrl: extractInviteUrlFromResponse(raw),
    raw,
  };
}

export async function revokeGroupInvite(
  config: WapiConfig,
  groupId: string,
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
  groupId: string,
): Promise<WapiGroupMetadata> {
  const raw = await wapiRequest<Record<string, unknown>>(
    config,
    "/group/group-metadata",
    { extraParams: { groupId } },
  );
  return extractGroupMetadata(raw, groupId);
}

export function extractGroupMetadata(
  raw: Record<string, unknown>,
  fallbackId: string,
): WapiGroupMetadata {
  const candidates = rankedGroupRecords(raw);
  const participants = firstArrayLike(candidates, [
    "participants",
    "members",
    "users",
  ]);
  const size =
    findFirstNumber(candidates, [
      "size",
      "participantsCount",
      "participantCount",
      "participants_count",
      "participant_count",
      "memberCount",
      "membersCount",
      "member_count",
      "members_count",
      "usersCount",
      "userCount",
      "totalParticipants",
      "total_members",
      "totalMembers",
      "total",
      "count",
    ]) ?? participants.length;
  const explicitAdminsCount = findFirstNumber(candidates, [
    "adminsCount",
    "adminCount",
    "admins_count",
    "admin_count",
  ]);
  const adminsCount =
    explicitAdminsCount ??
    participants.filter((participant) => {
      if (!isRecord(participant)) return false;
      const role = String(
        participant.admin || participant.role || participant.type || "",
      ).toLowerCase();
      return (
        participant.admin === true ||
        participant.isAdmin === true ||
        participant.isSuperAdmin === true ||
        role === "admin" ||
        role === "superadmin"
      );
    }).length;
  const name =
    firstNonEmptyString(candidates, [
      "subject",
      "name",
      "groupName",
      "title",
    ]) || "";

  return {
    id:
      firstNonEmptyString(candidates, [
        "id",
        "jid",
        "groupId",
        "groupJid",
        "remoteJid",
        "_id",
      ]) || fallbackId,
    name,
    memberCount: size,
    adminsCount,
  };
}

export async function disconnectInstance(
  config: WapiConfig,
): Promise<{ error?: boolean; message?: string; instanceId?: string }> {
  return wapiRequest(config, "/instance/disconnect");
}

export async function restartInstance(
  config: WapiConfig,
): Promise<{ error?: boolean; message?: string }> {
  return wapiRequest(config, "/instance/restart");
}

/**
 * Quantidade de mensagens ainda pendentes na fila interna da W-API.
 * A rota responde 404 quando a fila esta vazia, por isso esse caso equivale a
 * zero em vez de erro. Usamos a consulta antes de reiniciar uma sessao para
 * nunca liberar acidentalmente mensagens antigas que ainda estejam pendentes.
 */
export async function getWapiQueueSize(config: WapiConfig): Promise<number> {
  const params = new URLSearchParams({
    instanceId: config.instanceId,
    perPage: "1",
    page: "1",
  });
  const url = `https://api.w-api.app/v1/quere/quere?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  const text = await response.text().catch(() => "");
  const safeText = text.replaceAll(config.token, "[redacted]");

  if (response.status === 404 && /n[aã]o h[aá] mensagens na fila/i.test(text)) {
    return 0;
  }
  if (!response.ok) {
    throw new Error(`W-API ${response.status}: ${safeText.slice(0, 300)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("W-API retornou uma resposta invalida ao consultar a fila.");
  }
  if (!isRecord(body)) return 0;
  const total = toFiniteNumber(body.totalMessages);
  if (total != null) return Math.max(0, Math.floor(total));
  return Array.isArray(body.messages) ? body.messages.length : 0;
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
  config: WapiConfig,
): Promise<{ healthy: boolean; reason?: string }> {
  // 1) status check — must be connected
  let status: { connected?: boolean } | null = null;
  try {
    status = await wapiRequest<{ connected?: boolean }>(
      config,
      "/instance/status-instance",
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
  delayMessage = 1,
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
  delayMessage = 1,
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
  delayMessage = 1,
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
  delayMessage = 1,
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
): Promise<WapiSendResult> {
  return wapiRequest(config, "/message/send-document", {
    method: "POST",
    body: { phone, document, extension, fileName, caption, delayMessage },
  });
}

const MESSAGE_ENDPOINTS: Record<WapiMessageType, string> = {
  text: "/message/send-text",
  image: "/message/send-image",
  video: "/message/send-video",
  audio: "/message/send-audio",
  document: "/message/send-document",
  sticker: "/message/send-sticker",
  gif: "/message/send-gif",
  ptv: "/message/send-ptv",
  location: "/message/send-location",
  contact: "/message/send-contact",
  contacts: "/message/send-contacts",
  button_actions: "/message/send-button-actions",
  buttons: "/message/send-button-list",
  otp: "/message/send-button-otp",
  pix: "/message/send-button-pix",
  carousel: "/message/send-carousel",
  list: "/message/send-list",
  poll: "/message/send-poll",
  reaction: "/message/send-reaction",
  remove_reaction: "/message/remove-reaction",
};

/**
 * Envia qualquer formato documentado pela W-API para um chat. O campo phone
 * aceita tanto telefone quanto JID de grupo; o payload chega aqui previamente
 * normalizado pela API do dashboard.
 */
export async function sendWapiMessage(
  config: WapiConfig,
  messageType: WapiMessageType,
  phone: string,
  payload: WapiMessagePayload,
  delayMessage = 1,
): Promise<WapiSendResult> {
  const wirePayload = toWapiWirePayload(messageType, payload);
  return wapiRequest(config, MESSAGE_ENDPOINTS[messageType], {
    method: "POST",
    body: { phone, ...wirePayload, delayMessage },
  });
}
