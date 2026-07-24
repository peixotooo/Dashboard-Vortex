import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { dispatchGiftRequest } from "@/lib/gift-request/dispatch";
import { upsertGiftRequestLead } from "@/lib/gift-request/crm-lead";
import { getStorefrontCors } from "@/lib/cors";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { normalizePublicBrowserUrl } from "@/lib/security/external-url";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_PER_IP_PER_DAY = 10;
const MAX_PER_RECIPIENT_PER_DAY = 3;

// Aceita "+55 11 99999-8888", "(11) 99999-8888", "11999998888" etc.
// Normaliza pra E.164-ish: garante o + e os dígitos. Se o usuário esqueceu
// o código do país e for número BR com 10/11 dígitos, prepend 55.
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (hasPlus) return `+${digits}`;
  // Heurística BR (10 ou 11 dígitos sem código do país)
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

function sanitizeText(raw: unknown, max = 500): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

function hashIp(ip: string, workspaceId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${workspaceId}:${ip}`)
    .digest("hex");
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

  const parsed = await readLimitedJson(request, 32 * 1024);
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

  const key = typeof body.key === "string" ? body.key : null;
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

  const requesterName = sanitizeText(body.requester_name, 120);
  const requesterPhoneRaw = sanitizeText(body.requester_phone, 40);
  const recipientPhoneRaw = sanitizeText(body.recipient_phone, 40);
  const productId = sanitizeText(body.product_id, 64);
  const productName = sanitizeText(body.product_name, 200);
  const productUrl = normalizePublicBrowserUrl(body.product_url);
  const productImage = normalizePublicBrowserUrl(body.product_image_url);
  const productPriceRaw = body.product_price;
  const productPrice =
    typeof productPriceRaw === "number"
      ? productPriceRaw
      : typeof productPriceRaw === "string" && productPriceRaw.trim()
      ? parseFloat(productPriceRaw.replace(",", "."))
      : null;
  const safeProductPrice =
    productPrice !== null &&
    Number.isFinite(productPrice) &&
    productPrice >= 0 &&
    productPrice <= 10_000_000
      ? productPrice
      : null;
  const personalMessage = sanitizeText(body.personal_message, 500);
  const sessionId = sanitizeText(body.session_id, 80);
  const consumerId = sanitizeText(body.consumer_id, 80);
  const pageUrl = normalizePublicBrowserUrl(body.page_url);

  if (!requesterName) {
    return NextResponse.json(
      { error: "requester_name required" },
      { status: 400, headers: cors }
    );
  }
  const recipientPhone = normalizePhone(recipientPhoneRaw);
  if (!recipientPhone) {
    return NextResponse.json(
      { error: "recipient_phone invalid" },
      { status: 400, headers: cors }
    );
  }
  if (!productId) {
    return NextResponse.json(
      { error: "product_id required" },
      { status: 400, headers: cors }
    );
  }

  const requesterPhone = requesterPhoneRaw
    ? normalizePhone(requesterPhoneRaw)
    : null;

  const admin = createAdminClient();

  // Carrega config do workspace
  const { data: config } = await admin
    .from("gift_request_configs")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (!config || !config.enabled) {
    return NextResponse.json(
      { error: "gift_request_disabled" },
      { status: 403, headers: cors }
    );
  }

  // Rate limit por IP (anti-flood). x-real-ip é setado pela Vercel
  // (não-spoofável); o 1º valor do x-forwarded-for é controlado pelo cliente
  // (dá pra furar o limite trocando o header) — usa o ÚLTIMO como fallback.
  const ip = getRequestClientIp(request);
  const ipHash = hashIp(ip, auth.workspaceId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [minuteLimit, dailyIpLimit, dailyRecipientLimit] = await Promise.all([
    consumeSecurityRateLimit({
      scope: "gift-request:submit:minute",
      key: `${auth.workspaceId}:${ip}`,
      limit: 5,
    }),
    consumeSecurityRateLimit({
      scope: "gift-request:submit:daily-ip",
      key: `${auth.workspaceId}:${ip}`,
      limit: MAX_PER_IP_PER_DAY,
      windowSeconds: 86_400,
    }),
    consumeSecurityRateLimit({
      scope: "gift-request:submit:daily-recipient",
      key: `${auth.workspaceId}:${recipientPhone}`,
      limit: MAX_PER_RECIPIENT_PER_DAY,
      windowSeconds: 86_400,
    }),
  ]);
  if (
    !minuteLimit.allowed ||
    !dailyIpLimit.allowed ||
    !dailyRecipientLimit.allowed
  ) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: cors }
    );
  }

  const { count: ipCount } = await admin
    .from("gift_requests")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", auth.workspaceId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if ((ipCount || 0) >= MAX_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: "rate_limited_ip" },
      { status: 429, headers: cors }
    );
  }

  // Rate limit por destinatário (evita usar a feature pra spam)
  const { count: recipientCount } = await admin
    .from("gift_requests")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", auth.workspaceId)
    .eq("recipient_phone", recipientPhone)
    .gte("created_at", since);

  if ((recipientCount || 0) >= MAX_PER_RECIPIENT_PER_DAY) {
    return NextResponse.json(
      { error: "rate_limited_recipient" },
      { status: 429, headers: cors }
    );
  }

  // Cria o registro primeiro pra ter id; depois enfileira.
  const { data: gr, error: insErr } = await admin
    .from("gift_requests")
    .insert({
      workspace_id: auth.workspaceId,
      requester_name: requesterName,
      requester_phone: requesterPhone,
      requester_session_id: sessionId || null,
      requester_consumer_id: consumerId || null,
      recipient_phone: recipientPhone,
      product_id: productId,
      product_name: productName || null,
      product_url: productUrl || null,
      product_image_url: productImage || null,
      product_price: safeProductPrice,
      personal_message: personalMessage || null,
      status: "queued",
      page_url: pageUrl || null,
      user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
      ip_hash: ipHash,
    })
    .select()
    .single();

  if (insErr || !gr) {
    return NextResponse.json(
      { error: insErr?.message || "insert_failed" },
      { status: 500, headers: cors }
    );
  }

  // Enfileira no canal WhatsApp.
  const dispatchResult = await dispatchGiftRequest({
    admin,
    workspaceId: auth.workspaceId,
    request: gr,
    templateId: config.wa_template_id,
    variableMapping: config.wa_variable_mapping || {},
  });

  if (!dispatchResult.ok) {
    await admin
      .from("gift_requests")
      .update({
        status: "failed",
        error_message: dispatchResult.error || "dispatch_failed",
      })
      .eq("id", gr.id);

    return NextResponse.json(
      { error: dispatchResult.error || "dispatch_failed" },
      { status: 500, headers: cors }
    );
  }

  await admin
    .from("gift_requests")
    .update({
      wa_campaign_id: dispatchResult.campaignId,
      wa_message_id: dispatchResult.messageId,
    })
    .eq("id", gr.id);

  // Captura o solicitante como lead na lista CRM "Pedidos de presente"
  // (dedup por phone normalizado). Best-effort — uma falha aqui não
  // bloqueia o envio do WhatsApp, só loga.
  if (requesterPhone) {
    try {
      const leadResult = await upsertGiftRequestLead({
        admin,
        workspaceId: auth.workspaceId,
        name: requesterName,
        phone: requesterPhone,
      });
      if (!leadResult.ok) {
        console.error(
          "[GiftRequest Submit] CRM lead capture failed:",
          leadResult.error
        );
      }
    } catch (err) {
      console.error("[GiftRequest Submit] CRM lead capture threw:", err);
    }
  }

  return NextResponse.json(
    { ok: true, id: gr.id },
    {
      status: 200,
      headers: { ...cors, "Cache-Control": "no-store" },
    }
  );
}

export async function OPTIONS(request: NextRequest) {
  const cors = await getStorefrontCors(request);
  return new NextResponse(null, {
    status: cors.allowed ? 204 : 403,
    headers: {
      ...cors.headers,
      "Access-Control-Max-Age": "86400",
    },
  });
}
