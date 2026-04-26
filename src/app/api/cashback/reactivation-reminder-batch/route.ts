import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig, type CashbackTransactionRow } from "@/lib/cashback/api";
import { sendReminderForStage } from "@/lib/cashback/reminders";

export const maxDuration = 300;

/**
 * Manual reactivation-reminder campaign. Sporadic by design — there is NO
 * cron job firing this. Sends the REATIVACAO_LEMBRETE template (WhatsApp +
 * email) to a filtered set of cashbacks that are currently REATIVADO.
 *
 * Body filters:
 *   - daysSinceReactivation: only rows where depositado_em <= now - X days
 *   - daysUntilExpiration: only rows where expira_em >= now + X days (lower bound)
 *   - minValue: only rows with valor_cashback >= X
 *   - emailLike: filter by email substring
 *   - dryRun: just count, don't send
 *   - limit: cap how many rows are touched (default 100, max 500)
 *
 * Idempotent per cashback via reativacao_lembrete2 timestamp — re-running the
 * same filter won't send to the same row twice unless reset=true is passed.
 */
export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    filter?: {
      daysSinceReactivation?: number;
      daysUntilExpiration?: number;
      minValue?: number;
      emailLike?: string;
    };
    limit?: number;
    dryRun?: boolean;
    reset?: boolean;
  };

  const limit = Math.min(500, Math.max(1, body.limit || 100));
  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);

  let query = auth!.admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .eq("status", "REATIVADO")
    .limit(limit);

  if (!body.reset) {
    query = query.is("reativacao_lembrete2", null);
  }
  if (body.filter?.daysSinceReactivation) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - body.filter.daysSinceReactivation);
    query = query.lte("depositado_em", since.toISOString());
  }
  if (body.filter?.daysUntilExpiration) {
    const limit = new Date();
    limit.setUTCDate(limit.getUTCDate() + body.filter.daysUntilExpiration);
    query = query.lte("expira_em", limit.toISOString());
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
    return NextResponse.json({
      dryRun: true,
      count: candidates?.length ?? 0,
      sample: (candidates ?? []).slice(0, 5).map((c) => ({
        id: c.id,
        email: c.email,
        valor_cashback: c.valor_cashback,
        depositado_em: c.depositado_em,
        expira_em: c.expira_em,
      })),
    });
  }

  let success = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const c of (candidates || []) as CashbackTransactionRow[]) {
    if (body.reset && c.reativacao_lembrete2) {
      await auth!.admin
        .from("cashback_transactions")
        .update({ reativacao_lembrete2: null })
        .eq("id", c.id);
      c.reativacao_lembrete2 = null;
    }
    try {
      const results = await sendReminderForStage(c, "REATIVACAO_LEMBRETE", cfg, auth!.admin);
      const anySent = results.some((r) => r.sent);
      if (anySent) {
        success++;
      } else {
        skipped.push({ id: c.id, reason: results.map((r) => `${r.channel}:${r.skipped || r.error}`).join(",") });
      }
    } catch (e) {
      skipped.push({ id: c.id, reason: e instanceof Error ? e.message : "error" });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: success,
    skipped: skipped.length,
    total_candidates: candidates?.length ?? 0,
    skipped_details: skipped.slice(0, 20),
  });
}
