import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig, reactivateCashback } from "@/lib/cashback/api";
import {
  depositVndaCredit,
  getVndaCreditsConfigFromDb,
} from "@/lib/cashback/vnda-credits";
import { sendReminderForStage } from "@/lib/cashback/reminders";

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;
  const { id } = await params;

  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);

  const { data: current } = await auth!.admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (current.status !== "EXPIRADO") {
    return NextResponse.json(
      { error: `cannot_reactivate_from:${current.status}` },
      { status: 400 }
    );
  }

  // VNDA deposit
  if (cfg.enable_deposit) {
    const vnda = await getVndaCreditsConfigFromDb(auth!.workspaceId, auth!.admin);
    if (!vnda) return NextResponse.json({ error: "no_vnda_config" }, { status: 400 });
    const newExpires = new Date();
    newExpires.setUTCDate(newExpires.getUTCDate() + cfg.reactivation_days);
    // Stable reference so a future refund (D+30) can match it exactly.
    // Reactivation is guarded by reativado=true in the FSM so the reference
    // can't be reused for a second reactivation.
    const dep = await depositVndaCredit(vnda, {
      email: current.email,
      amount: Number(current.valor_cashback),
      reference: `BULKING-REACTIVATION-${current.id}`,
      validUntil: newExpires,
    });
    if (!dep.ok) {
      return NextResponse.json({ error: `vnda_failed:${dep.error}` }, { status: 502 });
    }
  }

  const result = await reactivateCashback(auth!.workspaceId, id, cfg, auth!.admin);
  if (!result.ok || !result.row) {
    return NextResponse.json({ error: result.error || "reactivate_failed" }, { status: 500 });
  }

  // Fire reactivation reminder (non-blocking best-effort)
  try {
    await sendReminderForStage(result.row, "REATIVACAO", cfg, auth!.admin);
  } catch (e) {
    console.error("[cashback reactivate] reminder failed", e);
  }

  return NextResponse.json({ ok: true, transaction: result.row });
}
