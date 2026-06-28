import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 10;

const VALID_EVENT_TYPES = new Set([
  "checkout_started",
  "checkout_step_viewed",
  "checkout_field_started",
  "checkout_field_completed",
  "checkout_field_error",
  "checkout_shipping_calculated",
  "checkout_shipping_selected",
  "checkout_payment_method_selected",
  "checkout_payment_attempted",
  "checkout_purchase_completed",
  "checkout_abandon_snapshot",
]);

const VALID_STEPS = new Set([
  "cart",
  "identification",
  "shipping",
  "payment",
  "confirmation",
  "unknown",
]);

const VALID_FIELD_GROUPS = new Set([
  "contact",
  "address",
  "shipping",
  "payment",
  "coupon",
  "other",
]);

const VALID_FIELD_KEYS = new Set([
  "email",
  "phone",
  "document",
  "birthdate",
  "name",
  "last_name",
  "shipping_zip",
  "shipping_address",
  "address_number",
  "address_complement",
  "neighborhood",
  "city",
  "state",
  "coupon",
  "card_number",
  "card_cvv",
  "card_expiry",
  "card_holder",
  "installments",
  "field_other",
]);

const VALID_PAYMENT_METHODS = new Set([
  "pix",
  "credit_card",
  "debit_card",
  "boleto",
  "other",
]);

const VALID_SHIPPING_METHODS = new Set([
  "sedex",
  "pac",
  "pickup",
  "motoboy",
  "transportadora",
  "other",
]);

const VALID_ERROR_CODES = new Set([
  "required",
  "invalid_email",
  "invalid_document",
  "invalid_phone",
  "invalid_zip",
  "invalid_coupon",
  "invalid_card",
  "payment_failed",
  "shipping_unavailable",
  "unknown",
]);

const SAFE_META_KEYS = new Set([
  "tracker_version",
  "device",
  "viewport_width",
  "viewport_height",
  "fields_touched_count",
  "fields_completed_count",
  "errors_count",
  "last_field_key",
  "last_step",
  "has_coupon",
  "cart_value_bucket",
  "elapsed_ms",
]);

const MAX_BATCH_EVENTS = 50;
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const RATE_LIMIT_MAX_EVENTS = 1500;

const rateBuckets = new Map<
  string,
  { resetAt: number; requests: number; events: number }
>();

function configuredAllowedOrigins() {
  const configured = (process.env.CHECKOUT_EVENTS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);

  return configured.length > 0
    ? configured
    : [
        "https://bulking.com.br",
        "https://www.bulking.com.br",
        "https://checkout.bulking.com.br",
        "https://dash.bulking.com.br",
        "https://dashboard-vortex.vercel.app",
      ];
}

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return false;
  const normalized = parsed.origin.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  return configuredAllowedOrigins().some((allowed) => {
    if (allowed === normalized) return true;
    if (allowed.startsWith("https://*.")) {
      const suffix = allowed.slice("https://*.".length);
      return host.endsWith(`.${suffix}`);
    }
    return false;
  });
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : "https://www.bulking.com.br",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] || request.headers.get("x-real-ip") || "unknown")
    .trim()
    .slice(0, 80);
}

function rateLimitKey(request: NextRequest, publicKey: string | null) {
  return `${publicKey || "missing"}:${clientIp(request)}`;
}

function checkRateLimit(key: string, eventCount: number) {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { resetAt: now + RATE_LIMIT_WINDOW_MS, requests: 0, events: 0 };
  bucket.requests += 1;
  bucket.events += eventCount;
  rateBuckets.set(key, bucket);

  if (rateBuckets.size > 10000) {
    for (const [bucketKey, value] of rateBuckets.entries()) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }

  return (
    bucket.requests <= RATE_LIMIT_MAX_REQUESTS &&
    bucket.events <= RATE_LIMIT_MAX_EVENTS
  );
}

function safeToken(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return normalized || null;
}

function isJsonContentType(request: NextRequest) {
  const contentType = request.headers.get("content-type");
  if (!contentType) return true;
  return /^(application\/json|text\/plain)\b/i.test(contentType);
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split("?")[0].split("#")[0].slice(0, 300);
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1_000_000, n));
}

function safeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!SAFE_META_KEYS.has(key)) continue;
    if (typeof raw === "boolean") {
      out[key] = raw;
      continue;
    }
    if (typeof raw === "number") {
      const n = safeNumber(raw);
      if (n != null) out[key] = n;
      continue;
    }
    if (typeof raw === "string") {
      const token = safeToken(raw, 80);
      if (token) out[key] = token;
    }
  }

  return out;
}

function safeOccurredAt(value: unknown): string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function buildCheckoutEventRow(
  raw: unknown,
  body: Record<string, unknown>,
  workspaceId: string
): { row?: Record<string, unknown>; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Invalid event payload" };
  }

  const event = raw as Record<string, unknown>;
  const sessionId =
    typeof event.session_id === "string"
      ? event.session_id
      : typeof body.session_id === "string"
        ? body.session_id
        : "";

  if (
    !sessionId ||
    sessionId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(sessionId)
  ) {
    return { error: "Invalid session_id" };
  }

  const eventType = safeToken(event.event_type);
  if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
    return { error: "Invalid event_type" };
  }

  const step = safeToken(event.step);
  const fieldKey = safeToken(event.field_key);
  const fieldGroup = safeToken(event.field_group);
  const paymentMethod = safeToken(event.payment_method);
  const shippingMethod = safeToken(event.shipping_method);
  const errorCode = safeToken(event.error_code);
  const consumerId =
    event.consumer_id != null
      ? safeToken(event.consumer_id, 128)
      : safeToken(body.consumer_id, 128);

  return {
    row: {
      workspace_id: workspaceId,
      session_id: sessionId,
      consumer_id: consumerId,
      event_type: eventType,
      step: step && VALID_STEPS.has(step) ? step : "unknown",
      field_key: fieldKey && VALID_FIELD_KEYS.has(fieldKey) ? fieldKey : null,
      field_group:
        fieldGroup && VALID_FIELD_GROUPS.has(fieldGroup) ? fieldGroup : null,
      payment_method:
        paymentMethod && VALID_PAYMENT_METHODS.has(paymentMethod)
          ? paymentMethod
          : null,
      shipping_method:
        shippingMethod && VALID_SHIPPING_METHODS.has(shippingMethod)
          ? shippingMethod
          : null,
      error_code:
        errorCode && VALID_ERROR_CODES.has(errorCode) ? errorCode : null,
      path: safePath(event.path),
      metadata: {
        ...safeMetadata(event.metadata),
        ...(safeBool(event.debug) === true || safeBool(body.debug) === true
          ? { debug: true }
          : {}),
      },
      occurred_at: safeOccurredAt(event.occurred_at),
    },
  };
}

export async function POST(request: NextRequest) {
  const CORS_HEADERS = corsHeaders(request);
  let body: Record<string, unknown>;
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413, headers: CORS_HEADERS }
    );
  }
  if (!isJsonContentType(request)) {
    return NextResponse.json(
      { error: "Unsupported content type" },
      { status: 415, headers: CORS_HEADERS }
    );
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413, headers: CORS_HEADERS }
      );
    }
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Invalid body");
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const key = typeof body.key === "string" ? body.key : null;
  if (!key || key.length > 256) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }
  const eventPayloads = Array.isArray(body.events) ? body.events : [body];
  if (eventPayloads.length === 0) {
    return NextResponse.json(
      { error: "No events" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (eventPayloads.length > MAX_BATCH_EVENTS) {
    return NextResponse.json(
      { error: `Too many events. Max ${MAX_BATCH_EVENTS}` },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!checkRateLimit(rateLimitKey(request, key), eventPayloads.length)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: CORS_HEADERS }
    );
  }

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const rows: Record<string, unknown>[] = [];
  for (const eventPayload of eventPayloads) {
    const built = buildCheckoutEventRow(eventPayload, body, auth.workspaceId);
    if (built.error || !built.row) {
      return NextResponse.json(
        { error: built.error || "Invalid event" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    rows.push(built.row);
  }

  const admin = createAdminClient();

  try {
    await admin.from("checkout_events").insert(rows);

    return NextResponse.json(
      { ok: true, inserted: rows.length },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Checkout Events]", error instanceof Error ? error.message : "insert_failed");
    return NextResponse.json(
      { ok: false },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const CORS_HEADERS = corsHeaders(request);
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return new NextResponse(null, {
      status: 403,
      headers: CORS_HEADERS,
    });
  }
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
