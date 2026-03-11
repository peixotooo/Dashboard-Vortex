import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  mapVndaPayloadToCrmRow,
  validateWebhookPayload,
} from "@/lib/vnda-webhook";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  // Look up workspace by webhook token
  const { data: connection, error: connError } = await admin
    .from("vnda_connections")
    .select("workspace_id")
    .eq("webhook_token", token)
    .limit(1)
    .single();

  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logWebhook(admin, workspaceId, null, "error", null, "Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validateWebhookPayload(payload)) {
    await logWebhook(admin, workspaceId, null, "error", payload, "Payload validation failed: missing id, email, or total");
    // Return 200 to avoid VNDA retries on bad payloads
    return NextResponse.json({ ok: false, reason: "validation_failed" });
  }

  const orderId = String(payload.id);

  try {
    const row = mapVndaPayloadToCrmRow(payload, workspaceId);

    // Upsert: if same order arrives again, update instead of duplicate
    const { error: upsertError } = await admin
      .from("crm_vendas")
      .upsert(row, {
        onConflict: "workspace_id, source, source_order_id",
        ignoreDuplicates: false,
      });

    if (upsertError) {
      // Check if it's a unique constraint violation (duplicate)
      if (upsertError.code === "23505") {
        await logWebhook(admin, workspaceId, orderId, "duplicate", null, null);
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
      throw upsertError;
    }

    await logWebhook(admin, workspaceId, orderId, "success", null, null);
    return NextResponse.json({ ok: true, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[VNDA Webhook] Error processing order ${orderId}:`, message);
    await logWebhook(admin, workspaceId, orderId, "error", payload, message);
    // Return 200 to prevent aggressive retries from VNDA
    return NextResponse.json({ ok: false, reason: "processing_error" });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logWebhook(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  orderId: string | null,
  status: string,
  payload: unknown,
  errorMessage: string | null
) {
  try {
    await admin.from("vnda_webhook_logs").insert({
      workspace_id: workspaceId,
      order_id: orderId,
      status,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
      error_message: errorMessage,
    });
  } catch (logErr) {
    console.error("[VNDA Webhook] Failed to write log:", logErr);
  }
}
