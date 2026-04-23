import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  mapVndaPayloadToCrmRow,
  validateWebhookPayload,
} from "@/lib/vnda-webhook";
import {
  createCashbackFromOrder,
  markAsUsedFromOrder,
  cancelCashback,
  extractCreditUsed,
} from "@/lib/cashback/api";

export const maxDuration = 30;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  // Look up workspace by webhook token (with 5s timeout)
  const connectionResult = await withTimeout(
    Promise.resolve(
      admin
        .from("vnda_connections")
        .select("workspace_id, enable_cashback")
        .eq("webhook_token", token)
        .limit(1)
        .single()
    ),
    5000
  );

  if (!connectionResult) {
    console.warn("[VNDA Webhook] DB timeout on token lookup");
    return NextResponse.json({ error: "DB timeout" }, { status: 503 });
  }

  const { data: connection, error: connError } = connectionResult;

  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;
  const enableCashback = Boolean(
    (connection as { enable_cashback?: boolean }).enable_cashback
  );

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logWebhook(admin, workspaceId, null, "error", null, "Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validateWebhookPayload(payload)) {
    console.warn(`[VNDA Webhook] Validation failed for workspace ${workspaceId}: missing id, email, or total`);
    await logWebhook(admin, workspaceId, null, "error", payload, "Payload validation failed: missing id, email, or total");
    // Return 200 to avoid VNDA retries on bad payloads
    return NextResponse.json({ ok: false, reason: "validation_failed" });
  }

  const orderId = String(payload.id);

  try {
    const row = mapVndaPayloadToCrmRow(payload, workspaceId);

    // Upsert: if same order arrives again, update instead of duplicate (with 8s timeout)
    const upsertResult = await withTimeout(
      Promise.resolve(
        admin
          .from("crm_vendas")
          .upsert(row, {
            onConflict: "workspace_id, source, source_order_id",
            ignoreDuplicates: false,
          })
      ),
      8000
    );

    if (!upsertResult) {
      console.warn(`[VNDA Webhook] DB timeout on upsert for order ${orderId}`);
      await logWebhook(admin, workspaceId, orderId, "error", null, "upsert timeout after 8s");
      return NextResponse.json({ ok: false, reason: "db_timeout" });
    }

    const { error: upsertError } = upsertResult;
    if (upsertError) {
      // Check if it's a unique constraint violation (duplicate)
      if (upsertError.code === "23505") {
        console.log(`[VNDA Webhook] Duplicate order ${orderId} for workspace ${workspaceId}`);
        await logWebhook(admin, workspaceId, orderId, "duplicate", null, null);
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
      throw upsertError;
    }

    console.log(`[VNDA Webhook] Order ${orderId} created for workspace ${workspaceId}`);
    await logWebhook(admin, workspaceId, orderId, "success", null, null);

    // Invalidate snapshot so CRM shows fresh data on next load
    await admin
      .from("crm_rfm_snapshots")
      .delete()
      .eq("workspace_id", workspaceId);

    // Cashback dispatch — isolated so any failure never breaks the webhook.
    if (enableCashback) {
      try {
        const status = (payload.status || "").toLowerCase();
        const creditUsed = extractCreditUsed(payload);

        if (status === "cancelled" || status === "canceled") {
          await cancelCashback(workspaceId, orderId, admin);
        } else if (creditUsed > 0) {
          await markAsUsedFromOrder(workspaceId, payload, { admin });
        } else {
          await createCashbackFromOrder(workspaceId, payload, { admin });
        }
      } catch (cashbackErr) {
        console.error(
          `[VNDA Webhook] Cashback dispatch failed for order ${orderId}:`,
          cashbackErr instanceof Error ? cashbackErr.message : cashbackErr
        );
      }
    }

    return NextResponse.json({ ok: true, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const details = err && typeof err === "object" ? JSON.stringify(err) : message;
    console.error(`[VNDA Webhook] Error processing order ${orderId} for workspace ${workspaceId}:`, message, err);
    await logWebhook(admin, workspaceId, orderId, "error", payload, details);
    // Return 200 to prevent aggressive retries from VNDA
    return NextResponse.json({ ok: false, reason: "processing_error", error: message });
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
