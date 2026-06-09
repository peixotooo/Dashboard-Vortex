import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateApiKey } from "@/lib/shelves/api-key";
import { buildCorsHeaders } from "@/lib/cors";
import {
  normalizeAttributionEmail,
  upsertMetaAttributionSnapshot,
} from "@/lib/meta-attribution";

// Captures Meta CAPI browser-side signals (fbc, fbp, client IP, user agent)
// keyed by the email the customer typed in the storefront checkout form.
// The VNDA confirmed-order webhook later joins this row by email and merges
// these signals into the server-side Purchase event — closing the matching
// gap that pure server-side events have.
//
// Public endpoint: CORS-enabled, gated by workspace API key (same keys used
// by shelves/track/recommend). Service-role insert; RLS read-only for
// workspace members.

interface Body {
  key: string;
  email: string;
  fbc?: string;
  fbp?: string;
  consumer_id?: string;
  user_agent?: string;
}

export async function POST(request: NextRequest) {
  const cors = buildCorsHeaders(request);

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: cors }
    );
  }

  const auth = await validateApiKey(body.key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: cors }
    );
  }

  const email = normalizeAttributionEmail(body.email);
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, reason: "missing_email" },
      { headers: cors }
    );
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = body.user_agent || request.headers.get("user-agent") || null;

  const admin = createAdminClient();
  const result = await upsertMetaAttributionSnapshot(admin, {
    workspaceId: auth.workspaceId,
    email,
    consumerId: body.consumer_id,
    fbc: body.fbc,
    fbp: body.fbp,
    clientIp,
    userAgent,
  });

  if (result.reason === "no_signals") {
    return NextResponse.json(
      { ok: false, reason: "no_signals" },
      { headers: cors }
    );
  }

  if (!result.ok) {
    console.error("[MetaAttribution] upsert failed:", result.error || result.reason);
    return NextResponse.json(
      { ok: false, error: result.error || result.reason },
      { status: 500, headers: cors }
    );
  }

  return NextResponse.json({ ok: true }, { headers: cors });
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
