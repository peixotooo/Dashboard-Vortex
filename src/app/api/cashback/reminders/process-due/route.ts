import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import {
  getOrCreateConfig,
  type CashbackStage,
  type CashbackTransactionRow,
} from "@/lib/cashback/api";
import { sendReminderForStage } from "@/lib/cashback/reminders";
import {
  ACTIVE_REMINDER_STAGES,
  daysAheadIso,
  daysAgoIso,
  finalReminderBeforeExpiryDays,
  secondReminderAfterDepositDays,
  stageTimingLabel,
} from "@/lib/cashback/reminder-schedule";

export const maxDuration = 120;

type StageResult = {
  stage: CashbackStage;
  label: string;
  candidates: number;
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  sample: Array<{
    id: string;
    email: string;
    valor_cashback: number;
    depositado_em: string | null;
    expira_em: string;
  }>;
};

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 250;
  return Math.min(1000, Math.max(1, Math.round(parsed)));
}

function parseStages(value: unknown): CashbackStage[] {
  if (!Array.isArray(value)) return ACTIVE_REMINDER_STAGES;
  const allowed = new Set<CashbackStage>(ACTIVE_REMINDER_STAGES);
  const out = value.filter((stage): stage is CashbackStage => allowed.has(stage as CashbackStage));
  return out.length > 0 ? Array.from(new Set(out)) : ACTIVE_REMINDER_STAGES;
}

async function loadDueRows(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  stage: CashbackStage,
  limit: number,
  cfg: Awaited<ReturnType<typeof getOrCreateConfig>>
): Promise<CashbackTransactionRow[]> {
  if (stage === "LEMBRETE_1") {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("status", ["ATIVO", "REATIVADO"])
      .not("depositado_em", "is", null)
      .is("lembrete1_enviado_em", null)
      .order("depositado_em", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data as CashbackTransactionRow[] | null) ?? [];
  }

  if (stage === "LEMBRETE_2") {
    const threshold = daysAgoIso(secondReminderAfterDepositDays(cfg));
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "ATIVO")
      .is("lembrete2_enviado_em", null)
      .lte("depositado_em", threshold)
      .order("depositado_em", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data as CashbackTransactionRow[] | null) ?? [];
  }

  const horizon = daysAheadIso(finalReminderBeforeExpiryDays(cfg));
  const { data, error } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["ATIVO", "REATIVADO"])
    .is("lembrete3_enviado_em", null)
    .lte("expira_em", horizon)
    .order("expira_em", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data as CashbackTransactionRow[] | null) ?? [];
}

export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: boolean;
    stages?: unknown;
    limit?: unknown;
  };

  const dryRun = body.dryRun !== false;
  const limit = clampLimit(body.limit);
  const stages = parseStages(body.stages);
  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);
  const results: StageResult[] = [];

  try {
    for (const stage of stages) {
      const rows = await loadDueRows(auth!.admin, auth!.workspaceId, stage, limit, cfg);
      const summary: StageResult = {
        stage,
        label: stageTimingLabel(stage, cfg),
        candidates: rows.length,
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
        sample: rows.slice(0, 8).map((row) => ({
          id: row.id,
          email: row.email,
          valor_cashback: Number(row.valor_cashback),
          depositado_em: row.depositado_em,
          expira_em: row.expira_em,
        })),
      };

      if (!dryRun) {
        for (const row of rows) {
          summary.processed++;
          const sendResults = await sendReminderForStage(row, stage, cfg, auth!.admin);
          if (sendResults.some((r) => r.sent)) summary.sent++;
          if (sendResults.every((r) => !r.sent)) summary.skipped++;
          if (sendResults.some((r) => r.error)) summary.errors++;
        }
      }

      results.push(summary);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar lembretes";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    limit,
    results,
  });
}
