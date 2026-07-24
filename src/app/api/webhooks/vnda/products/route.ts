import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncSingleProduct } from "@/lib/shelves/catalog-sync";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";
import {
  getWebhookSecret,
  readLimitedJson,
} from "@/lib/security/webhook-request";

export const maxDuration = 30;
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const token = getWebhookSecret(request);

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const rateLimit = await consumeSecurityRateLimit({
    scope: "webhook:vnda:products",
    key: `${getRequestClientIp(request)}:${token}`,
    limit: 600,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited" });
  }

  const admin = createAdminClient();

  // Look up workspace by webhook token
  const { data: connection, error: connError } = await admin
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .eq("webhook_token", token)
    .limit(1)
    .single();

  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;
  const storeHost = connection.store_host as string;

  const parsedBody = await readLimitedJson(request, MAX_WEBHOOK_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.error },
      { status: parsedBody.status }
    );
  }
  const payload = parsedBody.value;

  try {
    await syncSingleProduct(
      workspaceId,
      payload as Parameters<typeof syncSingleProduct>[1],
      storeHost
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Product Webhook]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
