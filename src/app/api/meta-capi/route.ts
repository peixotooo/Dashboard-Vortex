import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { validateApiKey } from "@/lib/shelves/api-key";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// BK COM pixel + token (destination account)
const PIXEL_ID = process.env.META_CAPI_PIXEL_ID || "1369443261478323";
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || "";
const API_VERSION = "v23.0";

function hashSHA256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Map our event names to Meta standard events
const EVENT_MAP: Record<string, string> = {
  pageview: "PageView",
  view_content: "ViewContent",
  add_to_cart: "AddToCart",
  purchase: "Purchase",
  search: "Search",
  initiate_checkout: "InitiateCheckout",
};

interface CAPIEvent {
  key: string;
  event_type: string;
  event_id?: string;
  url?: string;
  referrer?: string;
  user_agent?: string;
  ip?: string;
  fbc?: string;
  fbp?: string;
  email?: string;
  phone?: string;
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  value?: number;
  currency?: string;
}

export async function POST(request: NextRequest) {
  if (!ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "CAPI not configured" },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let body: CAPIEvent;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate API key (same keys used by shelves/track)
  const auth = await validateApiKey(body.key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const eventName = EVENT_MAP[body.event_type] || body.event_type;
  if (!eventName) {
    return NextResponse.json(
      { error: "Missing event_type" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Build user_data with hashing
  const userData: Record<string, string> = {};

  // Client IP from headers (forwarded by Vercel/CDN)
  const clientIp =
    body.ip ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "";
  if (clientIp) userData.client_ip_address = clientIp;

  // User agent
  const ua = body.user_agent || request.headers.get("user-agent") || "";
  if (ua) userData.client_user_agent = ua;

  // Facebook click ID and browser ID (from cookies passed by client)
  if (body.fbc) userData.fbc = body.fbc;
  if (body.fbp) userData.fbp = body.fbp;

  // PII - hash before sending
  if (body.email) userData.em = hashSHA256(body.email);
  if (body.phone) userData.ph = hashSHA256(body.phone);

  // Build custom_data
  const customData: Record<string, unknown> = {};
  if (body.content_ids) customData.content_ids = body.content_ids;
  if (body.content_name) customData.content_name = body.content_name;
  if (body.content_type) customData.content_type = body.content_type || "product";
  if (body.value) {
    customData.value = body.value;
    customData.currency = body.currency || "BRL";
  }

  const eventPayload = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id || `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event_source_url: body.url || "",
    action_source: "website",
    user_data: userData,
    custom_data: Object.keys(customData).length > 0 ? customData : undefined,
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [eventPayload] }),
      }
    );

    const result = await res.json();

    if (!res.ok) {
      console.error("[CAPI] Meta error:", JSON.stringify(result));
      return NextResponse.json(
        { ok: false, error: result.error?.message || "Meta API error" },
        { status: 502, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json({ ok: true, events_received: result.events_received }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[CAPI] Fetch error:", error);
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}
