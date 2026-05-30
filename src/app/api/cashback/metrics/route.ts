import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

interface Row {
  id: string;
  status: string;
  valor_cashback: number;
  valor_pedido: number;
  confirmado_em: string;
  depositado_em: string | null;
  usado_em: string | null;
  estornado_em: string | null;
}

interface UseEvent {
  cashback_id: string;
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
  since: string,
  dateColumn: "confirmado_em" | "usado_em"
): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 100000; from += pageSize) {
    let query = admin
      .from("cashback_transactions")
      .select("id, status, valor_cashback, valor_pedido, confirmado_em, depositado_em, usado_em, estornado_em")
      .eq("workspace_id", workspaceId)
      .gte(dateColumn, since)
      .range(from, from + pageSize - 1);

    if (dateColumn === "usado_em") query = query.not("usado_em", "is", null);

    const { data, error } = await query;

    if (error) throw error;
    rows.push(...((data as Row[] | null) || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function fetchUsageEvents(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  cashbackIds: string[]
): Promise<Map<string, UseEvent>> {
  const eventsByCashback = new Map<string, UseEvent>();
  const chunkSize = 500;

  for (let i = 0; i < cashbackIds.length; i += chunkSize) {
    const chunk = cashbackIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    const { data, error } = await admin
      .from("cashback_events")
      .select("cashback_id, payload, created_at")
      .eq("workspace_id", workspaceId)
      .eq("tipo", "USO")
      .in("cashback_id", chunk)
      .order("created_at", { ascending: false });

    if (error) throw error;

    for (const event of ((data as UseEvent[] | null) || [])) {
      if (!eventsByCashback.has(event.cashback_id)) {
        eventsByCashback.set(event.cashback_id, event);
      }
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
    if (t.status === "ATIVO" || t.status === "REATIVADO") {
      ativoNow += Number(t.valor_cashback);
    }
  }

  const conversionRate = depositadoCount > 0 ? usadoCount / depositadoCount : 0;
  const avgUsedTicket = usadoCount > 0 ? totalPedidoUsado / usadoCount : 0;
  const breakageRate = depositadoCount > 0 ? expirado / depositado : 0;

  return {
    counts: { pedidoCount: transactions.length, depositadoCount, usadoCount },
    totals: { emitido, depositado, usado, expirado, ativoNow },
    ratios: { conversionRate, breakageRate, avgUsedTicket },
  };
}

function summarizeUsage(
  usedTransactions: Row[],
  usageEvents: Map<string, UseEvent>,
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
    originalOrderValue += Number(t.valor_pedido);
    if (t.confirmado_em < since) {
      usedOutsideCohort++;
      usedOutsideCohortValue += Number(t.valor_cashback);
    }

    const event = usageEvents.get(t.id);
    const eventCreditUsed = numberFromPayload(event?.payload?.credit_used);
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

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const windowDays = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") || 30)));
  const since = windowStart(windowDays);

  let cohortTransactions: Row[];
  let usageTransactions: Row[];
  let usageEvents: Map<string, UseEvent>;
  try {
    cohortTransactions = await fetchPagedRows(auth!.admin, auth!.workspaceId, since, "confirmado_em");
    usageTransactions = await fetchPagedRows(auth!.admin, auth!.workspaceId, since, "usado_em");
    usageEvents = await fetchUsageEvents(
      auth!.admin,
      auth!.workspaceId,
      usageTransactions.map((t) => t.id)
    );
  } catch (dbErr) {
    const message = dbErr instanceof Error ? dbErr.message : "Erro ao carregar métricas";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const cohort = summarizeCohort(cohortTransactions);
  const usage = summarizeUsage(usageTransactions, usageEvents, since);

  return NextResponse.json({
    windowDays,
    cohort,
    usage,
    counts: cohort.counts,
    totals: cohort.totals,
    ratios: cohort.ratios,
  });
}
