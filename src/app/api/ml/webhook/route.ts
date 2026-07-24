import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";
import { POST as pullMercadoLivreOrder } from "../../sync/pull-order/route";

export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 1_000_000;
const DEFAULT_ML_WEBHOOK_IPS = new Set([
  "54.88.218.97",
  "18.215.140.160",
  "18.213.114.129",
  "18.206.34.84",
  "35.236.253.169",
  "35.245.91.34",
  "35.245.20.104",
  "35.186.182.146",
]);

interface MercadoLivreNotification {
  user_id: string;
  topic: string;
  resource: string;
  raw: Record<string, unknown>;
}

function normalizeIp(value: string): string {
  return value.trim().replace(/^::ffff:/i, "");
}

function getAllowedWebhookIps(): Set<string> {
  const configured = (process.env.ML_WEBHOOK_ALLOWED_IPS || "")
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
  return new Set([...DEFAULT_ML_WEBHOOK_IPS, ...configured]);
}

function isTrustedWebhookIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (
    process.env.NODE_ENV !== "production" &&
    (normalized === "127.0.0.1" || normalized === "::1")
  ) {
    return true;
  }
  return getAllowedWebhookIps().has(normalized);
}

function parseNotification(value: unknown): MercadoLivreNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const userId =
    typeof raw.user_id === "number" || typeof raw.user_id === "string"
      ? String(raw.user_id)
      : "";
  const topic = typeof raw.topic === "string" ? raw.topic.trim() : "";
  const resource = typeof raw.resource === "string" ? raw.resource.trim() : "";

  if (!/^\d{1,30}$/.test(userId)) return null;
  if (!/^[a-z0-9_]{1,80}$/i.test(topic)) return null;
  if (
    resource.length > 500 ||
    !resource.startsWith("/") ||
    /[\u0000-\u001f\u007f\\]/.test(resource)
  ) {
    return null;
  }

  return { user_id: userId, topic, resource, raw };
}

async function processNotification(
  notification: MercadoLivreNotification
): Promise<void> {
  const supabase = createAdminClient();
  const { data: cred } = await supabase
    .from("ml_credentials")
    .select("workspace_id")
    .eq("ml_user_id", notification.user_id)
    .limit(1)
    .maybeSingle();

  if (!cred?.workspace_id) return;

  await supabase.from("hub_logs").insert({
    workspace_id: cred.workspace_id,
    action: "webhook_received",
    entity: notification.topic === "orders_v2" ? "order" : "product",
    entity_id: notification.resource,
    direction: "ml_to_hub",
    status: "ok",
    details: notification.raw,
  });

  if (
    notification.topic !== "orders_v2" ||
    !/^\/orders\/\d+$/.test(notification.resource)
  ) {
    return;
  }

  const internalSecret = process.env.CRON_SECRET;
  if (!internalSecret) {
    console.error("[ml-webhook] CRON_SECRET is not configured");
    return;
  }

  try {
    const internalRequest = new NextRequest(
      "http://internal/api/sync/pull-order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": cred.workspace_id,
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ resource: notification.resource }),
      }
    );
    const response = await pullMercadoLivreOrder(internalRequest);
    if (!response.ok) {
      console.error(
        `[ml-webhook] pull-order failed with status ${response.status}`
      );
    }
  } catch (error) {
    console.error(
      "[ml-webhook] pull-order dispatch failed:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

/**
 * ML webhook notifications.
 * Must always return 200 — ML retries aggressively on failures.
 */
export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_WEBHOOK_BYTES
  ) {
    return NextResponse.json({ ok: true });
  }

  const clientIp = getRequestClientIp(req);
  if (!isTrustedWebhookIp(clientIp)) {
    console.warn(`[ml-webhook] Ignored untrusted source IP: ${clientIp}`);
    return NextResponse.json({ ok: true });
  }

  const rateLimit = await consumeSecurityRateLimit({
    scope: "ml:webhook:ip",
    key: clientIp,
    limit: 100,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: true });
  }

  const parsedBody = await readLimitedJson(req, MAX_WEBHOOK_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: true });

  const notification = parseNotification(parsedBody.value);
  if (!notification) return NextResponse.json({ ok: true });

  after(() => processNotification(notification));
  return NextResponse.json({ ok: true });
}
