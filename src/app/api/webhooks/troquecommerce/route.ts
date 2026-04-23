import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  applyExchangeDeduction,
  isActiveExchangeStatus,
  isTroqueWebhookPayload,
  type TroqueWebhookPayload,
} from "@/lib/cashback/troquecommerce";
import { getOrCreateConfig } from "@/lib/cashback/api";

export const maxDuration = 30;

async function logWebhook(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  payload: TroqueWebhookPayload | null,
  status: string,
  extra?: { cashbackId?: string | null; amountDeducted?: number | null; error?: string }
) {
  try {
    await admin.from("troquecommerce_webhook_logs").insert({
      workspace_id: workspaceId,
      external_id: payload?.id || null,
      ecommerce_number: payload?.ecommerce_number || null,
      reverse_type: payload?.reverse_type || null,
      status,
      cashback_id: extra?.cashbackId || null,
      amount_deducted: extra?.amountDeducted ?? null,
      payload: payload ? (payload as unknown as Record<string, unknown>) : null,
      error_message: extra?.error || null,
    });
  } catch {
    /* ignore log write failures */
  }
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: conn } = await admin
    .from("troquecommerce_config")
    .select("workspace_id")
    .eq("webhook_token", token)
    .maybeSingle();
  if (!conn?.workspace_id) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const workspaceId = conn.workspace_id as string;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await logWebhook(admin, workspaceId, null, "error", { error: "invalid_json" });
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!isTroqueWebhookPayload(body)) {
    await logWebhook(admin, workspaceId, null, "error", { error: "invalid_payload" });
    return NextResponse.json({ ok: false, reason: "invalid_payload" });
  }

  const payload = body;

  // Idempotency: if we've already processed this external id, short-circuit.
  const { data: prior } = await admin
    .from("troquecommerce_webhook_logs")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("external_id", payload.id)
    .in("status", ["processed", "no_cashback"])
    .limit(1)
    .maybeSingle();
  if (prior) {
    await logWebhook(admin, workspaceId, payload, "duplicate");
    return NextResponse.json({ ok: true, status: "duplicate" });
  }

  // Only act on statuses that indicate a real exchange/return in-flight or completed.
  if (!isActiveExchangeStatus(payload.status)) {
    await logWebhook(admin, workspaceId, payload, "ignored_status");
    return NextResponse.json({ ok: true, status: "ignored_status", reverse_status: payload.status });
  }

  // Find matching cashback by ecommerce_number (VNDA order code).
  const { data: cashback } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("numero_pedido", payload.ecommerce_number)
    .maybeSingle();

  if (!cashback) {
    await logWebhook(admin, workspaceId, payload, "no_cashback");
    return NextResponse.json({ ok: true, status: "no_cashback_for_order" });
  }

  try {
    const cfg = await getOrCreateConfig(workspaceId, admin);
    // Deduction base: prefer `price` (value of returned items) — falls back to
    // refund_value + exchange_value for edge cases where price is 0.
    const deductionBase =
      Number(payload.price) ||
      Number(payload.refund_value) + Number(payload.exchange_value) ||
      0;

    const result = await applyExchangeDeduction(cashback, cfg, deductionBase, admin);

    if (!result.applied) {
      await logWebhook(admin, workspaceId, payload, "skipped", {
        cashbackId: cashback.id,
        error: result.skipped,
      });
      return NextResponse.json({ ok: true, status: "skipped", reason: result.skipped });
    }

    await logWebhook(admin, workspaceId, payload, "processed", {
      cashbackId: cashback.id,
      amountDeducted: result.amountDeducted ?? null,
    });

    return NextResponse.json({
      ok: true,
      status: "processed",
      deduction: {
        amount: result.amountDeducted,
        previous: result.previousCashback,
        new: result.newCashback,
        vnda_withdrawal: result.vndaWithdrawalOk,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    await logWebhook(admin, workspaceId, payload, "error", { cashbackId: cashback.id, error: msg });
    return NextResponse.json({ ok: false, reason: "processing_error", error: msg });
  }
}
