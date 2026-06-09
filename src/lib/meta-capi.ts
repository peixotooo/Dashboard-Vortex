import { createHash } from "crypto";

// Meta Conversions API dispatcher. Centralizes hashing, payload shape, and
// the Graph API call so the public browser endpoint and server-side
// integrations (VNDA webhook etc.) share the exact same matching contract.

function env(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim();
}

const API_VERSION = env("META_CAPI_API_VERSION", "v23.0");
const DEFAULT_PIXEL_ID = env("META_CAPI_PIXEL_ID");
const DEFAULT_ACCESS_TOKEN = env("META_CAPI_ACCESS_TOKEN");
const FBC_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type MetaStandardEvent =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase"
  | "Search"
  | "Lead"
  | "CompleteRegistration";

// Map our internal lowercase event names to Meta's standard ones.
export const EVENT_MAP: Record<string, MetaStandardEvent> = {
  pageview: "PageView",
  view_content: "ViewContent",
  add_to_cart: "AddToCart",
  initiate_checkout: "InitiateCheckout",
  purchase: "Purchase",
  search: "Search",
  lead: "Lead",
  complete_registration: "CompleteRegistration",
};

// Raw user matching input — all optional. Server-side callers (webhook)
// will fill almost all of these; browser callers only what's available.
export interface CapiUserInput {
  // Already-hashed values pass-through is NOT supported here — caller must
  // pass cleartext and we'll hash. fbc/fbp/IP/UA are never hashed.
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  state?: string | null; // 2-letter code preferred
  zip?: string | null;
  country?: string | null; // 2-letter ISO (br, us, ...)
  birthdate?: string | null; // YYYY-MM-DD or YYYYMMDD
  gender?: string | null; // "m" | "f"
  external_id?: string | null; // hashed before sending
  client_ip_address?: string | null;
  client_user_agent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
}

export interface CapiCustomDataInput {
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  contents?: Array<{ id: string; quantity?: number; item_price?: number }>;
  value?: number;
  currency?: string;
  num_items?: number;
  order_id?: string;
}

export interface CapiEventInput {
  event_name: MetaStandardEvent;
  event_id?: string;
  event_time?: number; // unix seconds
  event_source_url?: string;
  action_source?: "website" | "email" | "app" | "phone_call" | "chat" | "physical_store" | "system_generated" | "other";
  user: CapiUserInput;
  custom?: CapiCustomDataInput;
}

export interface CapiSendOptions {
  pixelId?: string;
  accessToken?: string;
  testEventCode?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeFreshFbc(value?: string | null, nowMs = Date.now()): string | undefined {
  const fbc = value?.trim();
  if (!fbc) return undefined;

  const match = fbc.match(/^fb\.\d+\.(\d+)\..+$/);
  if (!match) return undefined;

  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) return undefined;

  const ageMs = nowMs - timestamp;
  if (ageMs < -5 * 60 * 1000 || ageMs > FBC_MAX_AGE_MS) return undefined;

  return fbc;
}

// Meta requires emails lowercased, phone digits-only with country code, names
// lowercased trimmed, state/country lowercased, zip first 5 chars / 8-digit BR
// trimmed, birthdate as YYYYMMDD. Hashing is SHA-256 hex of the normalized
// cleartext.
function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

function normPhone(v: string): string {
  // Strip everything except digits. For BR numbers VNDA payload includes only
  // local digits (area+number) without country code; prepend 55 if missing.
  const digits = v.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return "55" + digits;
}

function normName(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function normCity(v: string): string {
  // Meta wants lowercased, no special chars, no spaces.
  return normName(v).replace(/\s+/g, "");
}

function normState(v: string): string {
  // 2-letter lowercased state code if possible.
  const t = v.trim().toLowerCase();
  if (t.length === 2) return t;
  // Fallback: strip diacritics, take first 2 chars — caller should pass code.
  return normName(v).slice(0, 2);
}

function normZip(v: string): string {
  // BR CEPs may arrive as "12345-678"; strip non-digits.
  const digits = v.replace(/\D+/g, "");
  return digits;
}

function normCountry(v: string): string {
  return v.trim().toLowerCase().slice(0, 2);
}

function normBirthdate(v: string): string {
  // Accept YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD; output YYYYMMDD.
  const digits = v.replace(/\D+/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return "";
}

function normGender(v: string): string {
  const t = v.trim().toLowerCase();
  if (t.startsWith("m") || t === "masculino" || t === "male") return "m";
  if (t.startsWith("f") || t === "feminino" || t === "female") return "f";
  return "";
}

export function buildUserData(input: CapiUserInput): Record<string, unknown> {
  const ud: Record<string, unknown> = {};

  if (input.client_ip_address) ud.client_ip_address = input.client_ip_address;
  if (input.client_user_agent) ud.client_user_agent = input.client_user_agent;
  const fbc = normalizeFreshFbc(input.fbc);
  if (fbc) ud.fbc = fbc;
  if (input.fbp) ud.fbp = input.fbp;

  if (input.email) {
    const e = normEmail(input.email);
    if (e) ud.em = [sha256(e)];
  }
  if (input.phone) {
    const p = normPhone(input.phone);
    if (p) ud.ph = [sha256(p)];
  }
  if (input.first_name) {
    const n = normName(input.first_name);
    if (n) ud.fn = [sha256(n)];
  }
  if (input.last_name) {
    const n = normName(input.last_name);
    if (n) ud.ln = [sha256(n)];
  }
  if (input.city) {
    const c = normCity(input.city);
    if (c) ud.ct = [sha256(c)];
  }
  if (input.state) {
    const s = normState(input.state);
    if (s) ud.st = [sha256(s)];
  }
  if (input.zip) {
    const z = normZip(input.zip);
    if (z) ud.zp = [sha256(z)];
  }
  if (input.country) {
    const c = normCountry(input.country);
    if (c) ud.country = [sha256(c)];
  }
  if (input.birthdate) {
    const d = normBirthdate(input.birthdate);
    if (d) ud.db = [sha256(d)];
  }
  if (input.gender) {
    const g = normGender(input.gender);
    if (g) ud.ge = [sha256(g)];
  }
  if (input.external_id) {
    const e = input.external_id.trim().toLowerCase();
    if (e) ud.external_id = [sha256(e)];
  }

  return ud;
}

function buildCustomData(input?: CapiCustomDataInput): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const cd: Record<string, unknown> = {};
  if (input.content_ids?.length) cd.content_ids = input.content_ids;
  if (input.content_name) cd.content_name = input.content_name;
  if (input.content_type) cd.content_type = input.content_type;
  if (input.contents?.length) cd.contents = input.contents;
  if (typeof input.value === "number") cd.value = input.value;
  if (input.currency) cd.currency = input.currency;
  if (typeof input.num_items === "number") cd.num_items = input.num_items;
  if (input.order_id) cd.order_id = input.order_id;
  return Object.keys(cd).length > 0 ? cd : undefined;
}

export function buildEventPayload(event: CapiEventInput): Record<string, unknown> {
  return {
    event_name: event.event_name,
    event_time: event.event_time ?? Math.floor(Date.now() / 1000),
    event_id: event.event_id,
    event_source_url: event.event_source_url || undefined,
    action_source: event.action_source || "website",
    user_data: buildUserData(event.user),
    custom_data: buildCustomData(event.custom),
  };
}

export interface CapiSendResult {
  ok: boolean;
  status: number;
  events_received?: number;
  fbtrace_id?: string;
  error?: string;
}

export async function sendCapiEvent(
  event: CapiEventInput,
  options: CapiSendOptions = {}
): Promise<CapiSendResult> {
  const pixelId = options.pixelId || DEFAULT_PIXEL_ID;
  const accessToken = options.accessToken || DEFAULT_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return { ok: false, status: 503, error: "CAPI not configured" };
  }

  const payload: Record<string, unknown> = {
    data: [buildEventPayload(event)],
    access_token: accessToken,
  };
  if (options.testEventCode) payload.test_event_code = options.testEventCode;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${pixelId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const result = (await res.json()) as {
      events_received?: number;
      fbtrace_id?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: result.error?.message || "Meta API error",
        fbtrace_id: result.fbtrace_id,
      };
    }
    return {
      ok: true,
      status: res.status,
      events_received: result.events_received,
      fbtrace_id: result.fbtrace_id,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Fetch failed",
    };
  }
}

// Whether CAPI is configured at all (used to short-circuit dispatchers).
export function isCapiConfigured(): boolean {
  return Boolean(DEFAULT_PIXEL_ID && DEFAULT_ACCESS_TOKEN);
}
