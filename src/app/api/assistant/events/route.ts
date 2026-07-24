// POST /api/assistant/events — telemetria do funil do Chat Commerce v2.
//
// Mede a conversão real do assistente /chat: chat_opened → session_started →
// message_sent → products_shown → product_card_click → add_to_cart →
// cart_viewed → checkout_handoff → handoff_landed → order_placed.
//
// Segurança (espelha checkout-events): API key pública → workspace, CORS
// allowlist, rate-limit por IP+key, validação estrita, SEM PII crua (o atk é
// um id de sessão opaco; ip é hasheado; valor vem só em faixa). Em order_placed,
// materializa a atribuição sessão→pedido (a receita REAL entra depois, pelo
// webhook VNDA — o cliente nunca dita R$).

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { hashIp } from "@/lib/assistant/guardrails";
import { linkAssistantSessionToOrder } from "@/lib/assistant/attribution";
import { getStorefrontCors } from "@/lib/cors";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";
export const maxDuration = 10;

const VALID_EVENT_TYPES = new Set([
  "chat_opened",
  "session_started",
  "message_sent",
  "products_shown",
  "product_card_click",
  "add_to_cart",
  "cart_viewed",
  "checkout_handoff",
  "handoff_landed",
  "order_placed",
]);

const VALID_SURFACES = new Set(["global", "pdp", "unknown"]);
const VALID_BUCKETS = new Set(["0-99", "100-199", "200-349", "350-599", "600+"]);
const SAFE_META_KEYS = new Set([
  "count",
  "position",
  "size_present",
  "cart_lines",
  "cart_qty",
  "msg_index",
  "tool",
  "items_count",
  "reason",
]);

const MAX_BATCH_EVENTS = 30;
const MAX_BODY_BYTES = 32 * 1024;
const RATE_MAX_REQUESTS = 240;
const RATE_MAX_EVENTS = 1200;

function safeToken(v: unknown, max = 64): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return /^[\w-]+$/.test(t) ? t : null;
}

function safePath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t.startsWith("/")) return null;
  return t.split("?")[0].split("#")[0].slice(0, 300);
}

function safeMetadata(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!SAFE_META_KEYS.has(k)) continue;
    if (typeof raw === "boolean") out[k] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) out[k] = Math.max(0, Math.min(1e6, raw));
    else if (typeof raw === "string") out[k] = raw.slice(0, 64);
  }
  return out;
}

function safeOccurredAt(v: unknown): string {
  return typeof v === "string" && Number.isFinite(new Date(v).getTime())
    ? new Date(v).toISOString()
    : new Date().toISOString();
}

interface BuiltRow {
  row?: Record<string, unknown>;
  attribution?: {
    atk: string;
    order_token: string | null;
    order_code: string | null;
    order_id: string | null;
    occurred_at: string;
  };
  error?: string;
}

function buildRow(raw: unknown, body: Record<string, unknown>, workspaceId: string, ipHash: string): BuiltRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "invalid event" };
  const e = raw as Record<string, unknown>;

  const atk =
    (typeof e.session_id === "string" && e.session_id) ||
    (typeof e.atk === "string" && e.atk) ||
    (typeof body.session_id === "string" && body.session_id) ||
    "";
  if (!atk || atk.length > 128 || !/^[\w-]+$/.test(atk)) return { error: "invalid session_id" };

  const eventType = safeToken(e.event_type);
  if (!eventType || !VALID_EVENT_TYPES.has(eventType)) return { error: "invalid event_type" };

  const surface = safeToken(e.surface);
  const bucket = typeof e.value_bucket === "string" ? e.value_bucket : null;
  const productId = safeToken(e.product_id);
  const legacyOrderCode = safeToken(e.order_code);
  const explicitOrderToken = safeToken(e.order_token);
  const orderToken =
    explicitOrderToken ||
    (eventType === "order_placed" && legacyOrderCode && legacyOrderCode.length >= 24
      ? legacyOrderCode
      : null);
  const orderCode = orderToken === legacyOrderCode ? null : legacyOrderCode;
  const orderId = safeToken(e.order_id);
  const productIds = Array.isArray(e.product_ids)
    ? (e.product_ids as unknown[])
        .map((p) => safeToken(p))
        .filter((p): p is string => Boolean(p))
        .slice(0, 30)
    : null;

  const occurredAt = safeOccurredAt(e.occurred_at);
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    atk,
    event_type: eventType,
    surface: surface && VALID_SURFACES.has(surface) ? surface : null,
    product_id: productId,
    product_ids: productIds,
    value_bucket: bucket && VALID_BUCKETS.has(bucket) ? bucket : null,
    path: safePath(e.path),
    metadata: safeMetadata(e.metadata),
    order_code: orderCode,
    order_token: orderToken,
    order_id: orderId,
    ip_hash: ipHash,
    occurred_at: occurredAt,
  };

  // order_placed com código → materializa a atribuição (idempotente).
  const attribution =
    eventType === "order_placed" && (orderToken || orderCode || orderId)
      ? {
          atk,
          order_token: orderToken,
          order_code: orderCode,
          order_id: orderId,
          occurred_at: occurredAt,
        }
      : undefined;

  return { row, attribution };
}

export async function POST(request: NextRequest) {
  let corsResult = await getStorefrontCors(request);
  let cors = corsResult.headers;
  if (!corsResult.allowed) {
    return NextResponse.json({ error: "origin not allowed" }, { status: 403, headers: cors });
  }

  const ip = getRequestClientIp(request);
  const ingress = await consumeSecurityRateLimit({
    scope: "assistant-events:ingress",
    key: ip,
    limit: 300,
  });
  if (!ingress.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: cors });
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
      : null;
  if (!body) {
    return NextResponse.json({ error: "invalid json" }, { status: 400, headers: cors });
  }

  const key = typeof body.key === "string" ? body.key : null;
  if (!key || key.length > 256) {
    return NextResponse.json({ error: "invalid key" }, { status: 401, headers: cors });
  }

  const payloads = Array.isArray(body.events) ? body.events : [body];
  if (payloads.length === 0 || payloads.length > MAX_BATCH_EVENTS) {
    return NextResponse.json({ error: "bad batch" }, { status: 400, headers: cors });
  }

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "invalid key" }, { status: 401, headers: cors });
  }

  corsResult = await getStorefrontCors(request, auth.workspaceId);
  cors = corsResult.headers;
  if (!corsResult.allowed) {
    return NextResponse.json({ error: "origin not allowed" }, { status: 403, headers: cors });
  }

  const limiterKey = `${auth.workspaceId}:${ip}`;
  const [requestLimit, eventLimit] = await Promise.all([
    consumeSecurityRateLimit({
      scope: "assistant-events:requests",
      key: limiterKey,
      limit: RATE_MAX_REQUESTS,
    }),
    consumeSecurityRateLimit({
      scope: "assistant-events:events",
      key: limiterKey,
      limit: RATE_MAX_EVENTS,
      cost: payloads.length,
    }),
  ]);
  if (!requestLimit.allowed || !eventLimit.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: cors });
  }

  const ipHash = hashIp(ip);
  const rows: Record<string, unknown>[] = [];
  const attributions: NonNullable<BuiltRow["attribution"]>[] = [];
  for (const p of payloads) {
    const built = buildRow(p, body, auth.workspaceId, ipHash);
    if (built.error || !built.row) {
      return NextResponse.json(
        { error: built.error || "invalid event" },
        { status: 400, headers: cors }
      );
    }
    rows.push(built.row);
    if (built.attribution) attributions.push(built.attribution);
  }

  const admin = createAdminClient();
  try {
    // A superfície e a classificação de QA vêm da conversa autoritativa, não
    // do navegador. Isso impede um order_placed da PDP de virar "global".
    const atks = [...new Set(rows.map((row) => String(row.atk || "")).filter(Boolean))];
    const { data: conversations, error: convError } = await admin
      .from("assistant_conversations")
      .select("session_key, surface, is_test")
      .eq("workspace_id", auth.workspaceId)
      .in("session_key", atks);
    if (convError) throw convError;
    const contextByAtk = new Map(
      (conversations || []).map((conv) => [
        String(conv.session_key),
        {
          surface:
            conv.surface === "pdp" || conv.surface === "global"
              ? (conv.surface as "pdp" | "global")
              : ("unknown" as const),
          isTest: conv.is_test === true,
        },
      ])
    );
    for (const row of rows) {
      const context = contextByAtk.get(String(row.atk || ""));
      row.is_test = context?.isTest || false;
      if (context) row.surface = context.surface;
    }

    const { error: insertError } = await admin.from("assistant_events").insert(rows);
    if (insertError) throw insertError;
    // Atribuição client-side (fonte determinística): carimba o vínculo
    // sessão→pedido (atk). MERGE, não ignoreDuplicates: se o webhook VNDA já
    // criou a linha só com a receita, este upsert preenche o atk sem apagar a
    // receita (só seta as colunas fornecidas). A receita REAL é do webhook.
    for (const a of attributions) {
      const context = contextByAtk.get(a.atk);
      await linkAssistantSessionToOrder(admin, {
        workspaceId: auth.workspaceId,
        atk: a.atk,
        orderToken: a.order_token,
        orderCode: a.order_code,
        orderId: a.order_id,
        surface: context?.surface || "unknown",
        isTest: context?.isTest || false,
        placedAt: a.occurred_at,
      });
    }
    return NextResponse.json({ ok: true, inserted: rows.length }, { headers: cors });
  } catch (err) {
    console.error("[assistant events]", err instanceof Error ? err.message : "insert_failed");
    return NextResponse.json({ ok: false }, { status: 500, headers: cors });
  }
}

export async function OPTIONS(request: NextRequest) {
  const cors = await getStorefrontCors(request);
  return new NextResponse(null, {
    status: cors.allowed ? 204 : 403,
    headers: cors.headers,
  });
}
