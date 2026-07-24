import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import {
  readLimitedText,
  secretsEqual,
} from "@/lib/security/webhook-request";

export const maxDuration = 30;
const MAX_WEBHOOK_BYTES = 1_000_000;

// GET = Meta webhook verification (challenge)
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: "Webhook verify token not configured" }, { status: 503 });
  }

  if (
    mode === "subscribe" &&
    token &&
    secretsEqual(token, verifyToken)
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.WA_WEBHOOK_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret || !signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// POST = Meta webhook status updates
export async function POST(request: NextRequest) {
  try {
    const clientIp = getRequestClientIp(request);
    const rate = await consumeSecurityRateLimit({
      scope: "whatsapp:status-webhook",
      key: clientIp,
      limit: 300,
      windowSeconds: 60,
    });
    if (!rate.allowed) return NextResponse.json({ ok: true });

    const limited = await readLimitedText(request, MAX_WEBHOOK_BYTES);
    if (!limited.ok) return NextResponse.json({ ok: true });
    const rawBody = limited.value;
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (
      body.object !== "whatsapp_business_account" ||
      !Array.isArray(body.entry)
    ) {
      return NextResponse.json({ ok: true });
    }
    const admin = createAdminClient();

    // Meta sends: { object: "whatsapp_business_account", entry: [...] }
    const entries = body.entry.slice(0, 100);

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const changes = Array.isArray(
        (entry as { changes?: unknown }).changes
      )
        ? (entry as { changes: unknown[] }).changes.slice(0, 100)
        : [];
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const typedChange = change as {
          field?: unknown;
          value?: { statuses?: unknown };
        };
        if (typedChange.field !== "messages") continue;
        const statuses = Array.isArray(typedChange.value?.statuses)
          ? typedChange.value.statuses.slice(0, 500)
          : [];

        for (const s of statuses) {
          if (!s || typeof s !== "object") continue;
          const typedStatus = s as {
            id?: unknown;
            status?: unknown;
            timestamp?: unknown;
            errors?: Array<{ title?: unknown }>;
          };
          const metaMessageId =
            typeof typedStatus.id === "string" &&
            /^[a-zA-Z0-9._:-]{5,300}$/.test(typedStatus.id)
              ? typedStatus.id
              : "";
          const status =
            typeof typedStatus.status === "string"
              ? typedStatus.status
              : "";
          if (
            !metaMessageId ||
            !["sent", "delivered", "read", "failed"].includes(status)
          ) {
            continue;
          }
          const timestampValue =
            typeof typedStatus.timestamp === "string"
              ? Number.parseInt(typedStatus.timestamp, 10)
              : NaN;
          const timestamp = Number.isFinite(timestampValue)
            ? new Date(timestampValue * 1000).toISOString()
            : new Date().toISOString();

          // Update message status
          const updates: Record<string, unknown> = { status };
          if (status === "sent") updates.sent_at = timestamp;
          if (status === "delivered") updates.delivered_at = timestamp;
          if (status === "read") updates.read_at = timestamp;
          if (status === "failed") {
            const title = typedStatus.errors?.[0]?.title;
            updates.error_message =
              typeof title === "string"
                ? title.slice(0, 500)
                : "Unknown error";
          }

          const { data: msg } = await admin
            .from("wa_messages")
            .update(updates)
            .eq("meta_message_id", metaMessageId)
            .select("campaign_id")
            .single();

          // Update campaign counters
          if (msg?.campaign_id) {
            const countField = `${status}_count`;
            if (["sent", "delivered", "read", "failed"].includes(status)) {
              const { data: camp } = await admin
                .from("wa_campaigns")
                .select(countField)
                .eq("id", msg.campaign_id)
                .single();
              if (camp) {
                const current = (camp as unknown as Record<string, number>)[countField] || 0;
                await admin
                  .from("wa_campaigns")
                  .update({ [countField]: current + 1 })
                  .eq("id", msg.campaign_id);
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[WA Webhook]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: true }); // Always 200 to Meta
  }
}
