import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateApiKey } from "@/lib/shelves/api-key";
import { buildCorsHeaders } from "@/lib/cors";

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

function normEmail(v: string): string {
  return v.trim().toLowerCase();
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

  const email = body.email ? normEmail(body.email) : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, reason: "missing_email" },
      { headers: cors }
    );
  }

  // At least one of the browser signals must be present, otherwise the row
  // adds no value to a future Purchase event.
  if (!body.fbc && !body.fbp) {
    return NextResponse.json(
      { ok: false, reason: "no_signals" },
      { headers: cors }
    );
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = body.user_agent || request.headers.get("user-agent") || null;

  const admin = createAdminClient();
  const { error } = await admin.from("meta_attribution").upsert(
    {
      workspace_id: auth.workspaceId,
      email,
      consumer_id: body.consumer_id || null,
      fbc: body.fbc || null,
      fbp: body.fbp || null,
      client_ip: clientIp,
      user_agent: userAgent,
      captured_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,email" }
  );

  if (error) {
    console.error("[MetaAttribution] upsert failed:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
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
