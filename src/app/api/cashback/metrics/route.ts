import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig } from "@/lib/cashback/api";
import {
  CASHBACK_ADOPTION_TARGET_RATE,
  daysAheadIso,
  daysAgoIso,
  finalReminderBeforeExpiryDays,
  secondReminderAfterDepositDays,
} from "@/lib/cashback/reminder-schedule";

export const maxDuration = 30;

interface Row {
  id: string;
  status: string;
  email: string;
  telefone: string | null;
  valor_cashback: number;
  valor_pedido: number;
  confirmado_em: string;
  depositado_em: string | null;
  expira_em: string;
  usado_em: string | null;
  estornado_em: string | null;
  lembrete1_enviado_em: string | null;
  lembrete2_enviado_em: string | null;
  lembrete3_enviado_em: string | null;
  reativacao_enviado_em?: string | null;
  reativacao_lembrete2?: string | null;
}

interface EventRow {
  cashback_id: string;
  tipo: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface MetricsSummary {
  counts: {
    pedidoCount?: number;
    depositadoCount?: number;
    usadoCount: number;
    usedOutsideCohort?: number;
    eventsWithCreditUsed?: number;
  };
  totals: {
    emitido?: number;
    depositado?: number;
    usado: number;
    expirado?: number;
    ativoNow?: number;
    creditUsed?: number;
    originalOrderValue?: number;
    usedOutsideCohort?: number;
  };
  ratios: {
    conversionRate?: number;
    breakageRate?: number;
    avgUsedTicket?: number;
    avgCreditUsed?: number;
    avgCashbackUsed?: number;
  };
}

function windowStart(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function fetchPagedRows(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  opts?: {
    since?: string;
    dateColumn?: "confirmado_em" | "usado_em";
  }
): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 100000; from += pageSize) {
    let query = admin
      .from("cashback_transactions")
      .select(
        "id, status, email, telefone, valor_cashback, valor_pedido, confirmado_em, depositado_em, expira_em, usado_em, estornado_em, lembrete1_enviado_em, lembrete2_enviado_em, lembrete3_enviado_em, reativacao_enviado_em, reativacao_lembrete2"
      )
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);

    if (opts?.since && opts.dateColumn) {
      query = query.gte(opts.dateColumn, opts.since);
      if (opts.dateColumn === "usado_em") query = query.not("usado_em", "is", null);
    }

    const { data, error } = await query;

    if (error) throw error;
    rows.push(...((data as Row[] | null) || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function fetchEvents(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string
): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  const pageSize = 1000;
  const tipos = ["USO", "LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];

  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await admin
      .from("cashback_events")
      .select("cashback_id, tipo, payload, created_at")
      .eq("workspace_id", workspaceId)
      .in("tipo", tipos)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...((data as EventRow[] | null) || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function usageEventsByCashback(events: EventRow[]): Map<string, EventRow> {
  const eventsByCashback = new Map<string, EventRow>();
  for (const event of events) {
    if (event.tipo !== "USO") continue;
    if (!eventsByCashback.has(event.cashback_id)) {
      eventsByCashback.set(event.cashback_id, event);
    }
  }
  return eventsByCashback;
}

function numberFromPayload(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sum(rows: Row[], field: "valor_cashback" | "valor_pedido"): number {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function isDeposited(row: Row): boolean {
  return Boolean(row.depositado_em);
}

function isActive(row: Row): boolean {
  return row.status === "ATIVO" || row.status === "REATIVADO";
}

function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, diff / 86400000);
}

function summarizeCohort(transactions: Row[]): MetricsSummary {
  let emitido = 0;
  let depositado = 0;
  let usado = 0;
  let expirado = 0;
  let ativoNow = 0;
  let usadoCount = 0;
  let totalPedidoUsado = 0;
  let depositadoCount = 0;

  for (const t of transactions) {
    emitido += Number(t.valor_cashback);
    if (t.depositado_em) {
      depositado += Number(t.valor_cashback);
      depositadoCount++;
    }
    if (t.usado_em) {
      usado += Number(t.valor_cashback);
      usadoCount++;
      totalPedidoUsado += Number(t.valor_pedido);
    }
    if (t.estornado_em) {
      expirado += Number(t.valor_cashback);
    }
    if (isActive(t)) {
      ativoNow += Number(t.valor_cashback);
    }
  }

  const conversionRate = depositadoCount > 0 ? usadoCount / depositadoCount : 0;
  const avgUsedTicket = usadoCount > 0 ? totalPedidoUsado / usadoCount : 0;
  const breakageRate = depositadoCount > 0 && depositado > 0 ? expirado / depositado : 0;

  return {
    counts: { pedidoCount: transactions.length, depositadoCount, usadoCount },
    totals: { emitido, depositado, usado, expirado, ativoNow },
    ratios: { conversionRate, breakageRate, avgUsedTicket },
  };
}

function summarizeUsage(
  usedTransactions: Row[],
  usageEvents: Map<string, EventRow>,
  since: string
): MetricsSummary {
  let usado = 0;
  let creditUsed = 0;
  let originalOrderValue = 0;
  let eventsWithCreditUsed = 0;
  let usedOutsideCohort = 0;
  let usedOutsideCohortValue = 0;

  for (const t of usedTransactions) {
    usado += Number(t.valor_cashback);
    if (t.confirmado_em < since) {
      usedOutsideCohort++;
      usedOutsideCohortValue += Number(t.valor_cashback);
    }

    const event = usageEvents.get(t.id);
    const eventCreditUsed = numberFromPayload(event?.payload?.credit_used);
    const eventOrderTotal = numberFromPayload(event?.payload?.source_order_total);
    originalOrderValue += eventOrderTotal > 0 ? eventOrderTotal : Number(t.valor_pedido);
    if (eventCreditUsed > 0) {
      creditUsed += eventCreditUsed;
      eventsWithCreditUsed++;
    }
  }

  const usadoCount = usedTransactions.length;

  return {
    counts: { usadoCount, usedOutsideCohort, eventsWithCreditUsed },
    totals: { usado, creditUsed, originalOrderValue, usedOutsideCohort: usedOutsideCohortValue },
    ratios: {
      avgCreditUsed: usadoCount > 0 ? creditUsed / usadoCount : 0,
      avgCashbackUsed: usadoCount > 0 ? usado / usadoCount : 0,
    },
  };
}

function summarizeAdoption(allRows: Row[], usageEvents: Map<string, EventRow>) {
  const depositedRows = allRows.filter(isDeposited);
  const usedRows = depositedRows.filter((row) => Boolean(row.usado_em));
  const activeRows = allRows.filter(isActive);
  let creditUsed = 0;
  let returnOrderValue = 0;

  for (const row of usedRows) {
    const event = usageEvents.get(row.id);
    creditUsed += numberFromPayload(event?.payload?.credit_used);
    const sourceOrderTotal = numberFromPayload(event?.payload?.source_order_total);
    returnOrderValue += sourceOrderTotal > 0 ? sourceOrderTotal : Number(row.valor_pedido);
  }

  const usageRate = depositedRows.length > 0 ? usedRows.length / depositedRows.length : 0;
  const depositedValue = sum(depositedRows, "valor_cashback");
  const usedBalanceValue = sum(usedRows, "valor_cashback");

  return {
    depositedCount: depositedRows.length,
    usedCount: usedRows.length,
    activeCount: activeRows.length,
    usageRate,
    targetUsageRate: CASHBACK_ADOPTION_TARGET_RATE,
    usageGapToTarget: Math.max(0, CASHBACK_ADOPTION_TARGET_RATE - usageRate),
    depositedValue,
    usedBalanceValue,
    creditAppliedValue: creditUsed,
    returnOrderValue,
    activeValue: sum(activeRows, "valor_cashback"),
    valueUsageRate: depositedValue > 0 ? usedBalanceValue / depositedValue : 0,
  };
}

function valueBand(value: number): string {
  if (value < 5) return "Até R$ 4,99";
  if (value < 10) return "R$ 5 a R$ 9,99";
  if (value < 20) return "R$ 10 a R$ 19,99";
  if (value < 50) return "R$ 20 a R$ 49,99";
  return "R$ 50+";
}

const BAND_ORDER = ["Até R$ 4,99", "R$ 5 a R$ 9,99", "R$ 10 a R$ 19,99", "R$ 20 a R$ 49,99", "R$ 50+"];

function summarizeValueBands(allRows: Row[]) {
  const depositedRows = allRows.filter(isDeposited);
  const map = new Map<string, { label: string; count: number; usedCount: number; activeCount: number; value: number; usedValue: number }>();
  for (const label of BAND_ORDER) {
    map.set(label, { label, count: 0, usedCount: 0, activeCount: 0, value: 0, usedValue: 0 });
  }

  for (const row of depositedRows) {
    const entry = map.get(valueBand(Number(row.valor_cashback)))!;
    entry.count++;
    entry.value += Number(row.valor_cashback);
    if (row.usado_em) {
      entry.usedCount++;
      entry.usedValue += Number(row.valor_cashback);
    }
    if (isActive(row)) entry.activeCount++;
  }

  return BAND_ORDER.map((label) => {
    const entry = map.get(label)!;
    return {
      ...entry,
      usageRate: entry.count > 0 ? entry.usedCount / entry.count : 0,
    };
  });
}

function summarizeReminderFunnel(allRows: Row[], cfg: Awaited<ReturnType<typeof getOrCreateConfig>>) {
  const depositedRows = allRows.filter(isDeposited);
  const l1Sent = depositedRows.filter((row) => row.lembrete1_enviado_em);
  const l2Sent = depositedRows.filter((row) => row.lembrete2_enviado_em);
  const l3Sent = depositedRows.filter((row) => row.lembrete3_enviado_em);
  const l2Threshold = daysAgoIso(secondReminderAfterDepositDays(cfg));
  const l3Horizon = daysAheadIso(finalReminderBeforeExpiryDays(cfg));
  const l2BacklogRows = allRows.filter((row) =>
    row.status === "ATIVO" &&
    !row.lembrete2_enviado_em &&
    Boolean(row.depositado_em) &&
    row.depositado_em! <= l2Threshold
  );
  const l3BacklogRows = allRows.filter((row) =>
    isActive(row) &&
    !row.lembrete3_enviado_em &&
    row.expira_em <= l3Horizon
  );

  const exposureGroups = [
    {
      key: "sem_lembrete",
      label: "Sem lembrete",
      rows: depositedRows.filter((row) => !row.lembrete1_enviado_em && !row.lembrete2_enviado_em && !row.lembrete3_enviado_em),
    },
    {
      key: "l1",
      label: "L1 apenas",
      rows: depositedRows.filter((row) => row.lembrete1_enviado_em && !row.lembrete2_enviado_em && !row.lembrete3_enviado_em),
    },
    {
      key: "l1_l2",
      label: "L1 + L2",
      rows: depositedRows.filter((row) => row.lembrete1_enviado_em && row.lembrete2_enviado_em && !row.lembrete3_enviado_em),
    },
    {
      key: "l1_l2_l3",
      label: "L1 + L2 + L3",
      rows: depositedRows.filter((row) => row.lembrete1_enviado_em && row.lembrete2_enviado_em && row.lembrete3_enviado_em),
    },
  ];

  return {
    totalDeposited: depositedRows.length,
    stages: [
      { stage: "LEMBRETE_1", label: "L1 depósito", sentCount: l1Sent.length, coverageRate: depositedRows.length ? l1Sent.length / depositedRows.length : 0 },
      { stage: "LEMBRETE_2", label: `L2 D+${secondReminderAfterDepositDays(cfg)}`, sentCount: l2Sent.length, coverageRate: depositedRows.length ? l2Sent.length / depositedRows.length : 0 },
      { stage: "LEMBRETE_3", label: `L3 D-${finalReminderBeforeExpiryDays(cfg)}`, sentCount: l3Sent.length, coverageRate: depositedRows.length ? l3Sent.length / depositedRows.length : 0 },
    ],
    backlog: {
      l1Missing: depositedRows.filter((row) => !row.lembrete1_enviado_em).length,
      l2Due: l2BacklogRows.length,
      l2DueValue: sum(l2BacklogRows, "valor_cashback"),
      l3Due: l3BacklogRows.length,
      l3DueValue: sum(l3BacklogRows, "valor_cashback"),
    },
    exposure: exposureGroups.map((group) => {
      const usedCount = group.rows.filter((row) => row.usado_em).length;
      return {
        key: group.key,
        label: group.label,
        count: group.rows.length,
        usedCount,
        usageRate: group.rows.length > 0 ? usedCount / group.rows.length : 0,
      };
    }),
  };
}

function summarizeChannelCoverage(allRows: Row[], events: EventRow[], cfg: Awaited<ReturnType<typeof getOrCreateConfig>>) {
  const depositedRows = allRows.filter(isDeposited);
  const waGate = Number(cfg.whatsapp_min_value);
  const emailGate = Number(cfg.email_min_value);
  const waEligibleRows = depositedRows.filter((row) => Number(row.valor_cashback) >= waGate && Boolean(row.telefone));
  const emailEligibleRows = depositedRows.filter((row) => Number(row.valor_cashback) >= emailGate && Boolean(row.email));
  const skipCounts = new Map<string, { stage: string; channel: string; reason: string; count: number }>();

  for (const event of events) {
    if (!["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"].includes(event.tipo)) continue;
    const results = Array.isArray(event.payload?.results) ? event.payload?.results : [];
    for (const raw of results) {
      const item = raw as { channel?: string; sent?: boolean; skipped?: string | null; error?: string | null };
      if (item.sent) continue;
      const channel = item.channel || "unknown";
      const reason = item.skipped || item.error || "not_sent";
      const key = `${event.tipo}|${channel}|${reason}`;
      const current = skipCounts.get(key) ?? { stage: event.tipo, channel, reason, count: 0 };
      current.count++;
      skipCounts.set(key, current);
    }
  }

  return {
    whatsapp: {
      minValue: waGate,
      eligible: waEligibleRows.length,
      blockedByValue: depositedRows.filter((row) => Number(row.valor_cashback) < waGate).length,
      missingPhone: depositedRows.filter((row) => Number(row.valor_cashback) >= waGate && !row.telefone).length,
      potentialRate: depositedRows.length > 0 ? waEligibleRows.length / depositedRows.length : 0,
    },
    email: {
      minValue: emailGate,
      eligible: emailEligibleRows.length,
      blockedByValue: depositedRows.filter((row) => Number(row.valor_cashback) < emailGate).length,
      missingEmail: depositedRows.filter((row) => Number(row.valor_cashback) >= emailGate && !row.email).length,
      potentialRate: depositedRows.length > 0 ? emailEligibleRows.length / depositedRows.length : 0,
    },
    eventSkips: Array.from(skipCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

function summarizeActiveRisk(allRows: Row[], cfg: Awaited<ReturnType<typeof getOrCreateConfig>>) {
  const activeRows = allRows.filter(isActive);
  const expiring3d = activeRows.filter((row) => row.expira_em <= daysAheadIso(3));
  const expiring7d = activeRows.filter((row) => row.expira_em <= daysAheadIso(7));
  const oldNoUseRows = activeRows.filter((row) => Boolean(row.depositado_em) && row.depositado_em! <= daysAgoIso(20));
  const l2Threshold = daysAgoIso(secondReminderAfterDepositDays(cfg));
  const noL2EligibleRows = activeRows.filter((row) =>
    !row.lembrete2_enviado_em &&
    Boolean(row.depositado_em) &&
    row.depositado_em! <= l2Threshold
  );

  return {
    activeCount: activeRows.length,
    activeValue: sum(activeRows, "valor_cashback"),
    oldNoUseCount: oldNoUseRows.length,
    oldNoUseValue: sum(oldNoUseRows, "valor_cashback"),
    noL2EligibleCount: noL2EligibleRows.length,
    noL2EligibleValue: sum(noL2EligibleRows, "valor_cashback"),
    expiring3dCount: expiring3d.length,
    expiring3dValue: sum(expiring3d, "valor_cashback"),
    expiring7dCount: expiring7d.length,
    expiring7dValue: sum(expiring7d, "valor_cashback"),
  };
}

function summarizeUsageAttribution(allRows: Row[], usageEvents: Map<string, EventRow>) {
  const usedRows = allRows.filter((row) => Boolean(row.usado_em));
  let totalDelayDays = 0;
  let delayCount = 0;
  let usedWithin7d = 0;
  let usedAfter20d = 0;
  let creditUsed = 0;
  let returnOrderValue = 0;
  const lastReminder = new Map<string, { label: string; count: number; creditUsed: number; returnOrderValue: number }>();

  function addLast(label: string, rowCredit: number, rowReturn: number) {
    const current = lastReminder.get(label) ?? { label, count: 0, creditUsed: 0, returnOrderValue: 0 };
    current.count++;
    current.creditUsed += rowCredit;
    current.returnOrderValue += rowReturn;
    lastReminder.set(label, current);
  }

  for (const row of usedRows) {
    const delay = daysBetween(row.depositado_em, row.usado_em);
    if (delay != null) {
      totalDelayDays += delay;
      delayCount++;
      if (delay <= 7) usedWithin7d++;
      if (delay >= 20) usedAfter20d++;
    }

    const event = usageEvents.get(row.id);
    const rowCredit = numberFromPayload(event?.payload?.credit_used);
    const rowReturn = numberFromPayload(event?.payload?.source_order_total) || Number(row.valor_pedido);
    creditUsed += rowCredit;
    returnOrderValue += rowReturn;

    const usedAt = row.usado_em || "";
    const reminders = [
      ["L1", row.lembrete1_enviado_em],
      ["L2", row.lembrete2_enviado_em],
      ["L3", row.lembrete3_enviado_em],
      ["Reativação", row.reativacao_enviado_em],
      ["Lembrete reativação", row.reativacao_lembrete2],
    ].filter(([, at]) => at && String(at) <= usedAt) as Array<[string, string]>;

    reminders.sort((a, b) => b[1].localeCompare(a[1]));
    addLast(reminders[0]?.[0] ?? "Sem lembrete antes do uso", rowCredit, rowReturn);
  }

  return {
    usedCount: usedRows.length,
    creditUsed,
    returnOrderValue,
    avgUseDelayDays: delayCount > 0 ? totalDelayDays / delayCount : 0,
    usedWithin7d,
    usedAfter20d,
    lastReminderBeforeUse: Array.from(lastReminder.values()).sort((a, b) => b.count - a.count),
  };
}

function buildAlerts(
  reminderFunnel: ReturnType<typeof summarizeReminderFunnel>,
  activeRisk: ReturnType<typeof summarizeActiveRisk>,
  channelCoverage: ReturnType<typeof summarizeChannelCoverage>
) {
  return [
    {
      key: "l2_backlog",
      label: "L2 pendente",
      value: reminderFunnel.backlog.l2Due,
      amount: reminderFunnel.backlog.l2DueValue,
      severity: reminderFunnel.backlog.l2Due > 0 ? "warning" : "ok",
      description: "Cashbacks ativos que já deveriam ter recebido o segundo lembrete.",
    },
    {
      key: "expiring_7d",
      label: "Expira em 7 dias",
      value: activeRisk.expiring7dCount,
      amount: activeRisk.expiring7dValue,
      severity: activeRisk.expiring7dCount > 0 ? "warning" : "ok",
      description: "Saldo ativo próximo do vencimento.",
    },
    {
      key: "wa_gate",
      label: "WhatsApp bloqueado por gate",
      value: channelCoverage.whatsapp.blockedByValue,
      amount: 0,
      severity: channelCoverage.whatsapp.blockedByValue > 0 ? "info" : "ok",
      description: "Clientes abaixo do valor mínimo para WhatsApp.",
    },
  ];
}

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const windowDays = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") || 30)));
  const since = windowStart(windowDays);

  try {
    const [cfg, allTransactions, cohortTransactions, usageTransactions, allEvents] = await Promise.all([
      getOrCreateConfig(auth!.workspaceId, auth!.admin),
      fetchPagedRows(auth!.admin, auth!.workspaceId),
      fetchPagedRows(auth!.admin, auth!.workspaceId, { since, dateColumn: "confirmado_em" }),
      fetchPagedRows(auth!.admin, auth!.workspaceId, { since, dateColumn: "usado_em" }),
      fetchEvents(auth!.admin, auth!.workspaceId),
    ]);

    const usageEvents = usageEventsByCashback(allEvents);
    const cohort = summarizeCohort(cohortTransactions);
    const usage = summarizeUsage(usageTransactions, usageEvents, since);
    const adoption = summarizeAdoption(allTransactions, usageEvents);
    const reminderFunnel = summarizeReminderFunnel(allTransactions, cfg);
    const channelCoverage = summarizeChannelCoverage(allTransactions, allEvents, cfg);
    const valueBands = summarizeValueBands(allTransactions);
    const activeRisk = summarizeActiveRisk(allTransactions, cfg);
    const usageAttribution = summarizeUsageAttribution(allTransactions, usageEvents);

    return NextResponse.json({
      windowDays,
      cohort,
      usage,
      counts: cohort.counts,
      totals: cohort.totals,
      ratios: cohort.ratios,
      adoption,
      reminderFunnel,
      channelCoverage,
      valueBands,
      activeRisk,
      usageAttribution,
      alerts: buildAlerts(reminderFunnel, activeRisk, channelCoverage),
    });
  } catch (dbErr) {
    const message = dbErr instanceof Error ? dbErr.message : "Erro ao carregar métricas";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
