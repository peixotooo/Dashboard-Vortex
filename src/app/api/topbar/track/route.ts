import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getStorefrontCors } from "@/lib/cors";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const VALID_EVENTS = new Set(["impression", "click", "close"]);
const MAX_BODY_BYTES = 8 * 1024;

function safeIdentifier(value: unknown, max = 128): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 &&
    clean.length <= max &&
    /^[a-zA-Z0-9_.:-]+$/.test(clean)
    ? clean
    : null;
}

export async function POST(request: NextRequest) {
  let corsResult = await getStorefrontCors(request);
  let cors = corsResult.headers;
  if (!corsResult.allowed) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: cors }
    );
  }

  const clientIp = getRequestClientIp(request);
  const ingressLimit = await consumeSecurityRateLimit({
    scope: "topbar:track:ingress",
    key: clientIp,
    limit: 300,
    windowSeconds: 60,
  });
  if (!ingressLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: cors }
    );
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: cors }
    );
  }

  corsResult = await getStorefrontCors(request, auth.workspaceId);
  cors = corsResult.headers;
  if (!corsResult.allowed) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: cors }
    );
  }

  const rateLimit = await consumeSecurityRateLimit({
    scope: "topbar:track:workspace",
    key: `${auth.workspaceId}:${clientIp}`,
    limit: 240,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: cors }
    );
  }

  const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status, headers: cors }
    );
  }
  const body =
    parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : {};
  if (
    typeof body.event_type !== "string" ||
    !VALID_EVENTS.has(body.event_type)
  ) {
    return NextResponse.json(
      { error: "Invalid event" },
      { status: 400, headers: cors }
    );
  }

  const admin = createAdminClient();

  await admin.from("topbar_events").insert({
    workspace_id: auth.workspaceId,
    campaign_id: safeIdentifier(body.campaign_id, 80),
    variation_id: safeIdentifier(body.variation_id, 80),
    event_type: body.event_type,
    page_type: safeIdentifier(body.page_type, 40),
    session_id: safeIdentifier(body.session_id),
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}

export async function OPTIONS(request: NextRequest) {
  const corsResult = await getStorefrontCors(request);
  return new NextResponse(null, {
    status: corsResult.allowed ? 204 : 403,
    headers: {
      ...corsResult.headers,
      "Access-Control-Max-Age": "86400",
    },
  });
}
