import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { validateApiKey } from "@/lib/shelves/api-key";
import {
  normalizeAttributionEmail,
  upsertMetaAttributionSnapshot,
} from "@/lib/meta-attribution";
import {
  EVENT_MAP,
  isCapiConfigured,
  normalizeFreshFbc,
  sendCapiEvent,
  type MetaStandardEvent,
} from "@/lib/meta-capi";
import {
  getMetaCapiCredentials,
  isWorkspaceCapiEnabled,
} from "@/lib/meta-capi-settings";
import {
  isKnownStorefrontOrigin,
  isWorkspaceStorefrontOrigin,
  normalizeStorefrontOrigin,
  storefrontCorsHeaders,
} from "@/lib/security/storefront-origin";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
  securityRateLimitHeaders,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_CONTENT_IDS = 50;

interface CAPIBody {
  key: string;
  event_type: string;
  event_id?: string;
  url?: string;
  referrer?: string;
  user_agent?: string;
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

interface VerifiedPurchase {
  eventId: string;
  orderId: string;
  value: number;
  email: string;
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

function normalizeContentIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((item) => cleanString(item, 120))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_CONTENT_IDS);
  return ids.length > 0 ? ids : undefined;
}

function normalizeEventUrl(value: unknown, requestOrigin: string | null): string | undefined {
  const raw = cleanString(value, 2048);
  if (!raw || !requestOrigin) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.origin.toLowerCase() === requestOrigin ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function verifyBrowserPurchase(
  workspaceId: string,
  body: CAPIBody
): Promise<VerifiedPurchase | null> {
  const orderId = cleanString(body.order_id, 80);
  if (!orderId || !/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) return null;

  const expectedEventId = `vtx_purchase_${orderId}`;
  if (body.event_id !== expectedEventId) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_vendas")
    .select("email, valor")
    .eq("workspace_id", workspaceId)
    .eq("numero_pedido", orderId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const authoritativeEmail = normalizeAttributionEmail(data.email as string | null);
  const submittedEmail = normalizeAttributionEmail(body.email);
  const authoritativeValue = Number(data.valor);
  const submittedValue = Number(body.value);
  if (
    !authoritativeEmail ||
    authoritativeEmail !== submittedEmail ||
    !Number.isFinite(authoritativeValue) ||
    authoritativeValue <= 0 ||
    !Number.isFinite(submittedValue)
  ) {
    return null;
  }

  const tolerance = Math.max(0.05, authoritativeValue * 0.01);
  if (Math.abs(authoritativeValue - submittedValue) > tolerance) return null;

  return {
    eventId: expectedEventId,
    orderId,
    value: authoritativeValue,
    email: authoritativeEmail,
  };
}

async function snapshotAttribution(input: {
  workspaceId: string;
  email: string;
  consumerId?: string;
  fbc?: string;
  fbp?: string;
  clientIp?: string;
  userAgent?: string;
}) {
  try {
    const admin = createAdminClient();
    const result = await upsertMetaAttributionSnapshot(admin, {
      workspaceId: input.workspaceId,
      email: input.email,
      consumerId: input.consumerId,
      fbc: input.fbc,
      fbp: input.fbp,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
    });

    if (!result.ok && !result.reason) {
      console.warn("[CAPI] Attribution snapshot failed:", result.error);
    }
  } catch (error) {
    console.warn(
      "[CAPI] Attribution snapshot failed:",
      error instanceof Error ? error.message : error
    );
  }
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
  const body = parsedBody.value as CAPIBody;

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
      scope: "meta-capi-ip",
      key: `${auth.workspaceId}:${clientIp}`,
      limit: 240,
    }),
    consumeSecurityRateLimit({
      scope: "meta-capi-workspace",
      key: auth.workspaceId,
      limit: 5_000,
    }),
  ]);
  cors = {
    ...cors,
    ...securityRateLimitHeaders(ipRate, 240),
  };
  if (!ipRate.allowed || !workspaceRate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: cors }
    );
  }

  const enabled = await isWorkspaceCapiEnabled(auth.workspaceId);
  if (!enabled) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "CAPI disabled" },
      { headers: cors }
    );
  }

  const credentials = await getMetaCapiCredentials(auth.workspaceId);
  if (!credentials && !isCapiConfigured()) {
    return NextResponse.json(
      { error: "CAPI not configured" },
      { status: 503, headers: cors }
    );
  }

  const eventName = EVENT_MAP[body.event_type] as MetaStandardEvent | undefined;
  if (!eventName) {
    return NextResponse.json(
      { error: "Unknown event_type" },
      { status: 400, headers: cors }
    );
  }

  const verifiedPurchase =
    eventName === "Purchase"
      ? await verifyBrowserPurchase(auth.workspaceId, body)
      : null;
  if (eventName === "Purchase" && !verifiedPurchase) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "purchase_not_verified" },
      { status: 202, headers: cors }
    );
  }

  const userAgent = request.headers.get("user-agent") || undefined;
  const email = verifiedPurchase?.email || normalizeAttributionEmail(body.email);
  const fbc = normalizeFreshFbc(body.fbc);
  const fbp = /^fb\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(body.fbp?.trim() || "")
    ? body.fbp!.trim().slice(0, 200)
    : undefined;
  const requestOrigin = normalizeStorefrontOrigin(origin);

  await snapshotAttribution({
    workspaceId: auth.workspaceId,
    email,
    consumerId: body.external_id,
    fbc,
    fbp,
    clientIp: clientIp === "unknown" ? undefined : clientIp,
    userAgent,
  });

  const result = await sendCapiEvent(
    {
      event_name: eventName,
      event_id:
        verifiedPurchase?.eventId ||
        cleanString(body.event_id, 128) ||
        `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      event_source_url: normalizeEventUrl(body.url, requestOrigin),
      action_source: "website",
      user: {
        client_ip_address: clientIp === "unknown" ? undefined : clientIp,
        client_user_agent: userAgent,
        fbc,
        fbp,
        external_id: body.external_id,
        email,
        phone: verifiedPurchase ? undefined : cleanString(body.phone, 32),
        first_name: verifiedPurchase ? undefined : cleanString(body.first_name, 120),
        last_name: verifiedPurchase ? undefined : cleanString(body.last_name, 120),
        city: verifiedPurchase ? undefined : cleanString(body.city, 120),
        state: verifiedPurchase ? undefined : cleanString(body.state, 40),
        zip: verifiedPurchase ? undefined : cleanString(body.zip, 20),
        country: verifiedPurchase ? undefined : cleanString(body.country, 2),
        birthdate: verifiedPurchase ? undefined : cleanString(body.birthdate, 10),
        gender: verifiedPurchase ? undefined : cleanString(body.gender, 1),
      },
      custom: {
        content_ids: normalizeContentIds(body.content_ids),
        content_name: cleanString(body.content_name, 240),
        content_type:
          cleanString(body.content_type, 40) ||
          (body.content_ids?.length ? "product" : undefined),
        value:
          verifiedPurchase?.value ??
          (Number.isFinite(Number(body.value)) && Number(body.value) >= 0
            ? Math.min(Number(body.value), 10_000_000)
            : undefined),
        currency: body.value ? cleanString(body.currency, 3) || "BRL" : undefined,
        order_id: verifiedPurchase?.orderId,
      },
    },
    credentials ?? {}
  );

  if (!result.ok) {
    console.error("[CAPI] Send failed:", result.error, result.fbtrace_id);
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 502, headers: cors }
    );
  }

  return NextResponse.json(
    { ok: true, events_received: result.events_received },
    { headers: cors }
  );
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = await isKnownStorefrontOrigin(origin);
  return new NextResponse(null, {
    status: allowed ? 204 : 403,
    headers: storefrontCorsHeaders(origin, allowed),
  });
}
