import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getOrCreateConfig,
  logEvent,
  type CashbackConfigRow,
  type CashbackTransactionRow,
} from "@/lib/cashback/api";
import { sendReminderForStage } from "@/lib/cashback/reminders";
import {
  depositVndaCredit,
  refundVndaCredit,
  withdrawalVndaCredit,
  getVndaCreditsConfigFromDb,
  type VndaCreditsConfig,
} from "@/lib/cashback/vnda-credits";
import {
  getTroqueConfig,
  getExchangesForOrder,
  type TroqueConfig,
} from "@/lib/cashback/troquecommerce";

export const maxDuration = 300;

interface TickSummary {
  workspaceId: string;
  deposit: { processed: number; succeeded: number; failed: number };
  reminder1: { processed: number };
  reminder2: { processed: number };
  reminder3: { processed: number };
  refund: { processed: number; succeeded: number; failed: number };
  reactivationReminder: { processed: number };
}

function newTickSummary(workspaceId: string): TickSummary {
  return {
    workspaceId,
    deposit: { processed: 0, succeeded: 0, failed: 0 },
    reminder1: { processed: 0 },
    reminder2: { processed: 0 },
    reminder3: { processed: 0 },
    refund: { processed: 0, succeeded: 0, failed: 0 },
    reactivationReminder: { processed: 0 },
  };
}

const BATCH = 100;

function hoursAgo(h: number): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - h);
  return d.toISOString();
}

function daysAgo(d: number): string {
  const out = new Date();
  out.setUTCDate(out.getUTCDate() - d);
  return out.toISOString();
}

function daysAhead(d: number): string {
  const out = new Date();
  out.setUTCDate(out.getUTCDate() + d);
  return out.toISOString();
}

async function loadActiveWorkspaces(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin
    .from("vnda_connections")
    .select("workspace_id")
    .eq("enable_cashback", true);
  const set = new Set<string>();
  (data || []).forEach((r) => set.add(r.workspace_id as string));
  return Array.from(set);
}

// --- Job 1: deposit + first reminder ---
async function runDepositAndFirstReminder(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  cfg: CashbackConfigRow,
  vnda: VndaCreditsConfig | null,
  troque: TroqueConfig | null,
  summary: TickSummary
) {
  const threshold = daysAgo(cfg.deposit_delay_days);

  const { data: candidates } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "AGUARDANDO_DEPOSITO")
    .lte("confirmado_em", threshold)
    .limit(BATCH);

  for (const c of (candidates || []) as CashbackTransactionRow[]) {
    summary.deposit.processed++;

    let amount = Number(c.valor_cashback);
    let trocaAbatida = c.troca_abatida;
    let valorTrocaAbatida = c.valor_troca_abatida ?? null;

    // Troquecommerce: deduct 10% * exchange value
    if (cfg.enable_troquecommerce && troque && !trocaAbatida && c.numero_pedido) {
      try {
        const ex = await getExchangesForOrder(troque, c.numero_pedido);
        if (ex.totalValue > 0) {
          const cut = Math.min(amount, Number((ex.totalValue * (cfg.percentage / 100)).toFixed(2)));
          amount = Math.max(0, Number((amount - cut).toFixed(2)));
          trocaAbatida = true;
          valorTrocaAbatida = cut;
          await logEvent(admin, workspaceId, c.id, "TROCA_ABATIDA", {
            exchange_total: ex.totalValue,
            cut,
            remaining: amount,
          });
        }
      } catch (e) {
        console.error("[cashback tick] troque lookup failed", e);
      }
    }

    // If amount is zero after deduction, skip deposit and cancel cashback
    if (amount <= 0) {
      await admin
        .from("cashback_transactions")
        .update({
          valor_cashback: 0,
          troca_abatida: trocaAbatida,
          valor_troca_abatida: valorTrocaAbatida,
          status: "CANCELADO",
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      await logEvent(admin, workspaceId, c.id, "CANCELADO", { reason: "zero_after_exchange" });
      continue;
    }

    const now = new Date();
    const expira = new Date(now);
    expira.setUTCDate(expira.getUTCDate() + cfg.validity_days);

    // VNDA deposit
    let depositOk = true;
    if (cfg.enable_deposit && vnda) {
      const res = await depositVndaCredit(vnda, {
        email: c.email,
        amount,
        reference: `BULKING-CASHBACK-${c.id}`,
        validFrom: now,
        validUntil: expira,
      });
      depositOk = res.ok;
      if (!res.ok) {
        summary.deposit.failed++;
        await logEvent(admin, workspaceId, c.id, "DEPOSITO_FAILED", { error: res.error, status: res.status });
        continue;
      }
    }

    await admin
      .from("cashback_transactions")
      .update({
        valor_cashback: amount,
        troca_abatida: trocaAbatida,
        valor_troca_abatida: valorTrocaAbatida,
        status: "ATIVO",
        depositado_em: now.toISOString(),
        expira_em: expira.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", c.id);
    await logEvent(admin, workspaceId, c.id, "DEPOSITO", {
      amount,
      expira_em: expira.toISOString(),
    });
    summary.deposit.succeeded++;

    if (depositOk) {
      const fresh: CashbackTransactionRow = {
        ...c,
        valor_cashback: amount,
        troca_abatida: trocaAbatida,
        valor_troca_abatida: valorTrocaAbatida,
        status: "ATIVO",
        depositado_em: now.toISOString(),
        expira_em: expira.toISOString(),
      };
      await sendReminderForStage(fresh, "LEMBRETE_1", cfg, admin);
      summary.reminder1.processed++;
    }
  }
}

// --- Job 2: second reminder ---
async function runSecondReminder(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  cfg: CashbackConfigRow,
  summary: TickSummary
) {
  const offset = Math.max(1, cfg.reminder_2_day - cfg.deposit_delay_days);
  const threshold = daysAgo(offset);
  const { data: rows } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "ATIVO")
    .is("lembrete2_enviado_em", null)
    .lte("depositado_em", threshold)
    .limit(BATCH);

  for (const c of (rows || []) as CashbackTransactionRow[]) {
    summary.reminder2.processed++;
    await sendReminderForStage(c, "LEMBRETE_2", cfg, admin);
  }
}

// --- Job 3: third reminder (near expiration) ---
async function runThirdReminder(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  cfg: CashbackConfigRow,
  summary: TickSummary
) {
  const horizon = daysAhead(1); // expires within 24h
  const { data: rows } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["ATIVO", "REATIVADO"])
    .is("lembrete3_enviado_em", null)
    .lte("expira_em", horizon)
    .limit(BATCH);

  for (const c of (rows || []) as CashbackTransactionRow[]) {
    summary.reminder3.processed++;
    await sendReminderForStage(c, "LEMBRETE_3", cfg, admin);
  }
}

// --- Job 4: refund expired ---
async function runRefundExpired(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  cfg: CashbackConfigRow,
  vnda: VndaCreditsConfig | null,
  summary: TickSummary
) {
  const now = new Date().toISOString();
  const { data: rows } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["ATIVO", "REATIVADO"])
    .lte("expira_em", now)
    .limit(BATCH);

  for (const c of (rows || []) as CashbackTransactionRow[]) {
    summary.refund.processed++;

    if (cfg.enable_refund && vnda) {
      const res = await refundVndaCredit(vnda, {
        email: c.email,
        amount: Number(c.valor_cashback),
        reference: `BULKING-REFUND-${c.id}`,
      });
      if (!res.ok) {
        summary.refund.failed++;
        await logEvent(admin, workspaceId, c.id, "ESTORNO_FAILED", { error: res.error, status: res.status });
        continue;
      }
    }

    await admin
      .from("cashback_transactions")
      .update({
        status: "EXPIRADO",
        estornado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);
    await logEvent(admin, workspaceId, c.id, "ESTORNO", { amount: c.valor_cashback });
    summary.refund.succeeded++;
  }

  // Suppress unused-var warnings if withdrawalVndaCredit is not used directly here
  void withdrawalVndaCredit;
  void hoursAgo;
}

// --- Job 5: reactivation secondary reminder ---
async function runReactivationReminder(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  cfg: CashbackConfigRow,
  summary: TickSummary
) {
  const threshold = daysAgo(cfg.reactivation_reminder_day);
  const { data: rows } = await admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "REATIVADO")
    .is("reativacao_lembrete2", null)
    .lte("depositado_em", threshold)
    .limit(BATCH);

  for (const c of (rows || []) as CashbackTransactionRow[]) {
    summary.reactivationReminder.processed++;
    await sendReminderForStage(c, "REATIVACAO_LEMBRETE", cfg, admin);
  }
}

// --- Route handler ---
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const workspaces = await loadActiveWorkspaces(admin);
  const summaries: TickSummary[] = [];

  for (const workspaceId of workspaces) {
    const summary = newTickSummary(workspaceId);
    try {
      const cfg = await getOrCreateConfig(workspaceId, admin);
      const vnda = cfg.enable_deposit || cfg.enable_refund
        ? await getVndaCreditsConfigFromDb(workspaceId, admin)
        : null;
      const troque = cfg.enable_troquecommerce
        ? await getTroqueConfig(workspaceId, admin)
        : null;

      await runDepositAndFirstReminder(admin, workspaceId, cfg, vnda, troque, summary);
      await runSecondReminder(admin, workspaceId, cfg, summary);
      await runThirdReminder(admin, workspaceId, cfg, summary);
      await runRefundExpired(admin, workspaceId, cfg, vnda, summary);
      await runReactivationReminder(admin, workspaceId, cfg, summary);
    } catch (e) {
      console.error(`[cashback tick] workspace ${workspaceId} failed:`, e);
    }
    summaries.push(summary);
  }

  return NextResponse.json({ ok: true, summaries });
}
