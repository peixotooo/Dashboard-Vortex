import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import {
  EVENT_MAP,
  isCapiConfigured,
  sendCapiEvent,
  type MetaStandardEvent,
} from "@/lib/meta-capi";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

interface CAPIBody {
  key: string;
  event_type: string;
  event_id?: string;
  url?: string;
  referrer?: string;
  user_agent?: string;
  ip?: string;
  fbc?: string;
  fbp?: string;
  external_id?: string;
  // Advanced matching — only present when the storefront knows them
  // (logged-in users, account pages, post-purchase confirmations, etc.).
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  birthdate?: string;
  gender?: string;
  // Custom data
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  value?: number;
  currency?: string;
  order_id?: string;
}

export async function POST(request: NextRequest) {
  if (!isCapiConfigured()) {
    return NextResponse.json(
      { error: "CAPI not configured" },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let body: CAPIBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const auth = await validateApiKey(body.key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const eventName = EVENT_MAP[body.event_type] as MetaStandardEvent | undefined;
  if (!eventName) {
    return NextResponse.json(
      { error: "Unknown event_type" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const clientIp =
    body.ip ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;

  const userAgent = body.user_agent || request.headers.get("user-agent") || undefined;

  const result = await sendCapiEvent({
    event_name: eventName,
    event_id:
      body.event_id ||
      `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event_source_url: body.url,
    action_source: "website",
    user: {
      client_ip_address: clientIp,
      client_user_agent: userAgent,
      fbc: body.fbc,
      fbp: body.fbp,
      external_id: body.external_id,
      email: body.email,
      phone: body.phone,
      first_name: body.first_name,
      last_name: body.last_name,
      city: body.city,
      state: body.state,
      zip: body.zip,
      country: body.country,
      birthdate: body.birthdate,
      gender: body.gender,
    },
    custom: {
      content_ids: body.content_ids,
      content_name: body.content_name,
      content_type: body.content_type || (body.content_ids?.length ? "product" : undefined),
      value: body.value,
      currency: body.value ? body.currency || "BRL" : undefined,
      order_id: body.order_id,
    },
  });

  if (!result.ok) {
    console.error("[CAPI] Send failed:", result.error, result.fbtrace_id);
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 502, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, events_received: result.events_received },
    { headers: CORS_HEADERS }
  );
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
