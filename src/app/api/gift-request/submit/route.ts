import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { dispatchGiftRequest } from "@/lib/gift-request/dispatch";
import { upsertGiftRequestLead } from "@/lib/gift-request/crm-lead";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const key = typeof body.key === "string" ? body.key : null;
  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const requesterName = sanitizeText(body.requester_name, 120);
  const requesterPhoneRaw = sanitizeText(body.requester_phone, 40);
  const recipientPhoneRaw = sanitizeText(body.recipient_phone, 40);
  const productId = sanitizeText(body.product_id, 64);
  const productName = sanitizeText(body.product_name, 200);
  const productUrl = sanitizeText(body.product_url, 500);
  const productImage = sanitizeText(body.product_image_url, 500);
  const productPriceRaw = body.product_price;
  const productPrice =
    typeof productPriceRaw === "number"
      ? productPriceRaw
      : typeof productPriceRaw === "string" && productPriceRaw.trim()
      ? parseFloat(productPriceRaw.replace(",", "."))
      : null;
  const personalMessage = sanitizeText(body.personal_message, 500);
  const sessionId = sanitizeText(body.session_id, 80);
  const consumerId = sanitizeText(body.consumer_id, 80);
  const pageUrl = sanitizeText(body.page_url, 500);

  if (!requesterName) {
    return NextResponse.json(
      { error: "requester_name required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const recipientPhone = normalizePhone(recipientPhoneRaw);
  if (!recipientPhone) {
    return NextResponse.json(
      { error: "recipient_phone invalid" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!productId) {
    return NextResponse.json(
      { error: "product_id required" },
      { status: 400, headers: CORS_HEADERS }
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
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // Rate limit por IP (anti-flood)
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "0.0.0.0";
  const ipHash = hashIp(ip, auth.workspaceId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: ipCount } = await admin
    .from("gift_requests")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", auth.workspaceId)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if ((ipCount || 0) >= MAX_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: "rate_limited_ip" },
      { status: 429, headers: CORS_HEADERS }
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
      { status: 429, headers: CORS_HEADERS }
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
      product_price: productPrice && !isNaN(productPrice) ? productPrice : null,
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
      { status: 500, headers: CORS_HEADERS }
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
      { status: 500, headers: CORS_HEADERS }
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
      headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
    }
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
