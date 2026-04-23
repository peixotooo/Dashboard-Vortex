import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig, reactivateCashback } from "@/lib/cashback/api";
import {
  depositVndaCredit,
  getVndaCreditsConfigFromDb,
} from "@/lib/cashback/vnda-credits";
import { sendReminderForStage } from "@/lib/cashback/reminders";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    filter?: { expiredSinceDays?: number; minValue?: number; emailLike?: string };
    limit?: number;
    dryRun?: boolean;
  };

  const limit = Math.min(500, Math.max(1, body.limit || 100));
  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);

  // Query candidates
  let query = auth!.admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .eq("status", "EXPIRADO")
    .eq("reativado", false)
    .limit(limit);

  if (body.filter?.expiredSinceDays) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - body.filter.expiredSinceDays);
    query = query.gte("estornado_em", since.toISOString());
  }
  if (body.filter?.minValue) {
    query = query.gte("valor_cashback", body.filter.minValue);
  }
  if (body.filter?.emailLike) {
    query = query.ilike("email", `%${body.filter.emailLike}%`);
  }

  const { data: candidates, error: qErr } = await query;
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  if (body.dryRun) {
    return NextResponse.json({ dryRun: true, count: candidates?.length ?? 0, candidates });
  }

  const vnda = cfg.enable_deposit
    ? await getVndaCreditsConfigFromDb(auth!.workspaceId, auth!.admin)
    : null;

  let success = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const c of candidates || []) {
    try {
      if (cfg.enable_deposit) {
        if (!vnda) {
          failures.push({ id: c.id, error: "no_vnda_config" });
          continue;
        }
        const newExpires = new Date();
        newExpires.setUTCDate(newExpires.getUTCDate() + cfg.reactivation_days);
        const dep = await depositVndaCredit(vnda, {
          email: c.email,
          amount: Number(c.valor_cashback),
          description: `Reativação cashback pedido #${c.numero_pedido || c.source_order_id}`,
          expiresAt: newExpires,
        });
        if (!dep.ok) {
          failures.push({ id: c.id, error: `vnda:${dep.error}` });
          continue;
        }
      }

      const r = await reactivateCashback(auth!.workspaceId, c.id, cfg, auth!.admin);
      if (!r.ok || !r.row) {
        failures.push({ id: c.id, error: r.error || "reactivate_failed" });
        continue;
      }

      try {
        await sendReminderForStage(r.row, "REATIVACAO", cfg, auth!.admin);
      } catch (e) {
        console.error("[cashback batch] reminder failed", e);
      }
      success++;
    } catch (e) {
      failures.push({ id: c.id, error: e instanceof Error ? e.message : "error" });
    }
  }

  return NextResponse.json({ ok: true, success, failed: failures.length, failures });
}
