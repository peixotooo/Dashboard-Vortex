import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildCorsHeaders } from "@/lib/cors";

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

export async function POST(request: NextRequest) {
  const CORS_HEADERS = buildCorsHeaders(request);
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const key = typeof body.key === "string" ? body.key : null;
  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (
    !sessionId ||
    sessionId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(sessionId)
  ) {
    return NextResponse.json(
      { error: "Invalid session_id" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const eventType = safeToken(body.event_type);
  if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
    return NextResponse.json(
      { error: "Invalid event_type" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const step = safeToken(body.step);
  const fieldKey = safeToken(body.field_key);
  const fieldGroup = safeToken(body.field_group);
  const paymentMethod = safeToken(body.payment_method);
  const shippingMethod = safeToken(body.shipping_method);
  const errorCode = safeToken(body.error_code);
  const occurredAt =
    typeof body.occurred_at === "string" &&
    Number.isFinite(new Date(body.occurred_at).getTime())
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();

  const admin = createAdminClient();

  try {
    await admin.from("checkout_events").insert({
      workspace_id: auth.workspaceId,
      session_id: sessionId,
      consumer_id: safeToken(body.consumer_id, 128),
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
      path: safePath(body.path),
      metadata: {
        ...safeMetadata(body.metadata),
        ...(safeBool(body.debug) === true ? { debug: true } : {}),
      },
      occurred_at: occurredAt,
    });

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Checkout Events]", error);
    return NextResponse.json(
      { ok: false },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...buildCorsHeaders(request),
      "Access-Control-Max-Age": "86400",
    },
  });
}
