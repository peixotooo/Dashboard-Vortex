import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateApiKey } from "@/lib/shelves/api-key";
import {
  normalizeAttributionEmail,
  upsertMetaAttributionSnapshot,
} from "@/lib/meta-attribution";
import {
  isKnownStorefrontOrigin,
  isWorkspaceStorefrontOrigin,
  storefrontCorsHeaders,
} from "@/lib/security/storefront-origin";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
  securityRateLimitHeaders,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 8 * 1024;

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
  const origin = request.headers.get("origin");
  const knownOrigin = await isKnownStorefrontOrigin(origin);
  let cors = storefrontCorsHeaders(origin, knownOrigin);
  if (!knownOrigin) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: cors }
    );
  }

  const parsedBody = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      {
        error:
          parsedBody.error === "payload_too_large"
            ? "Payload too large"
            : "Invalid JSON",
      },
      { status: parsedBody.status, headers: cors }
    );
  }
  if (
    !parsedBody.value ||
    typeof parsedBody.value !== "object" ||
    Array.isArray(parsedBody.value)
  ) {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: cors }
    );
  }
  const body = parsedBody.value as Body;

  const auth = await validateApiKey(body.key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: cors }
    );
  }

  const workspaceOrigin = await isWorkspaceStorefrontOrigin(
    auth.workspaceId,
    origin
  );
  cors = storefrontCorsHeaders(origin, workspaceOrigin);
  if (!workspaceOrigin) {
    return NextResponse.json(
      { error: "Origin not allowed for workspace" },
      { status: 403, headers: cors }
    );
  }

  const clientIp = getRequestClientIp(request);
  const [ipRate, workspaceRate] = await Promise.all([
    consumeSecurityRateLimit({
      scope: "meta-attribution-ip",
      key: `${auth.workspaceId}:${clientIp}`,
      limit: 60,
    }),
    consumeSecurityRateLimit({
      scope: "meta-attribution-workspace",
      key: auth.workspaceId,
      limit: 1_000,
    }),
  ]);
  cors = {
    ...cors,
    ...securityRateLimitHeaders(ipRate, 60),
  };
  if (!ipRate.allowed || !workspaceRate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: cors }
    );
  }

  const email = normalizeAttributionEmail(body.email);
  if (!email || email.length > 320 || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, reason: "missing_email" },
      { headers: cors }
    );
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;

  const admin = createAdminClient();
  const result = await upsertMetaAttributionSnapshot(admin, {
    workspaceId: auth.workspaceId,
    email,
    consumerId: body.consumer_id?.trim().slice(0, 160),
    fbc: body.fbc,
    fbp: body.fbp,
    clientIp: clientIp === "unknown" ? null : clientIp,
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
  const origin = request.headers.get("origin");
  const allowed = await isKnownStorefrontOrigin(origin);
  return new NextResponse(null, {
    status: allowed ? 204 : 403,
    headers: storefrontCorsHeaders(origin, allowed),
  });
}
