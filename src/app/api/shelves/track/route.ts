import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getStorefrontCors } from "@/lib/cors";
import { shelfSourceColumnsAvailable } from "@/lib/shelves/source";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 8 * 1024;
const VALID_EVENT_TYPES = new Set([
  "pageview",
  "click",
  "add_to_cart",
  "purchase",
  "impression",
]);

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
    scope: "shelves:track:ingress",
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

  const {
    key,
    session_id,
    consumer_id,
    event_type,
    product_id,
    page_type,
    shelf_config_id,
    revenue,
  } = body;

  if (!session_id || !event_type) {
    return NextResponse.json(
      { error: "Missing session_id or event_type" },
      { status: 400, headers: cors }
    );
  }

  if (typeof event_type !== "string" || !VALID_EVENT_TYPES.has(event_type)) {
    return NextResponse.json(
      { error: `Invalid event_type. Valid: ${[...VALID_EVENT_TYPES].join(", ")}` },
      { status: 400, headers: cors }
    );
  }

  const sid = safeIdentifier(session_id);
  if (!sid) {
    return NextResponse.json(
      { error: "Invalid session_id format" },
      { status: 400, headers: cors }
    );
  }

  const auth = await validateApiKey(typeof key === "string" ? key : null);
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

  const workspaceLimit = await consumeSecurityRateLimit({
    scope: "shelves:track:workspace",
    key: `${auth.workspaceId}:${clientIp}`,
    limit: 240,
    windowSeconds: 60,
  });
  if (!workspaceLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: cors }
    );
  }

  const admin = createAdminClient();
  const consumerId = safeIdentifier(consumer_id);
  const productId = safeIdentifier(product_id);
  const pageType = safeIdentifier(page_type, 40);
  const shelfConfigId = safeIdentifier(shelf_config_id, 80);
  const numericRevenue = Number(revenue);

  // Carimba a loja dona do evento (source da key). Tolerante à migration-143:
  // sem as colunas no banco, grava exatamente como antes (tudo é vnda).
  const hasSource = await shelfSourceColumnsAvailable();

  try {
    // Insert event
    await admin.from("shelf_events").insert({
      workspace_id: auth.workspaceId,
      session_id: sid,
      consumer_id: consumerId,
      event_type,
      product_id: productId,
      page_type: pageType,
      shelf_config_id: shelfConfigId,
      revenue:
        Number.isFinite(numericRevenue) &&
        numericRevenue >= 0 &&
        numericRevenue <= 10_000_000
           ? numericRevenue
           : null,
      ...(hasSource ? { source: auth.source } : {}),
    });

    // Update consumer history on pageview
    if (
      event_type === "pageview" &&
      productId &&
      consumerId
    ) {
      await admin.from("shelf_consumer_history").upsert(
        {
          workspace_id: auth.workspaceId,
          consumer_id: consumerId,
          product_id: productId,
          views: 1,
          last_seen: new Date().toISOString(),
          ...(hasSource ? { source: auth.source } : {}),
        },
        {
          onConflict: hasSource
            ? "workspace_id,consumer_id,product_id,source"
            : "workspace_id,consumer_id,product_id",
        }
      );

      // Increment views for existing records
      try {
        await admin.rpc("increment_shelf_views", {
          p_workspace_id: auth.workspaceId,
          p_consumer_id: consumerId,
          p_product_id: productId,
        });
      } catch {
        // RPC may not exist yet, upsert above handles the insert case
      }
    }

    return NextResponse.json(
      { ok: true },
      { headers: cors }
    );
  } catch (error) {
    console.error(
      "[Shelves Track]",
      error instanceof Error ? error.message : "insert_failed"
    );
    return NextResponse.json({ ok: false }, { status: 500, headers: cors });
  }
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
