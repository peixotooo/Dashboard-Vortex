import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

interface Row {
  status: string;
  valor_cashback: number;
  valor_pedido: number;
  confirmado_em: string;
  depositado_em: string | null;
  usado_em: string | null;
  estornado_em: string | null;
}

function windowStart(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function fetchPagedRows(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  since: string
): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("status, valor_cashback, valor_pedido, confirmado_em, depositado_em, usado_em, estornado_em")
      .eq("workspace_id", workspaceId)
      .gte("confirmado_em", since)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...((data as Row[] | null) || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const windowDays = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") || 30)));
  const since = windowStart(windowDays);

  let transactions: Row[];
  try {
    transactions = await fetchPagedRows(auth!.admin, auth!.workspaceId, since);
  } catch (dbErr) {
    const message = dbErr instanceof Error ? dbErr.message : "Erro ao carregar métricas";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let emitido = 0;
  let depositado = 0;
  let usado = 0;
  let expirado = 0;
  let ativoNow = 0;
  let usadoCount = 0;
  let totalPedidoUsado = 0;
  let depositadoCount = 0;
  let pedidoCount = transactions.length;

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

  // Conversion = (depositado usado) / depositado
  const conversionRate = depositadoCount > 0 ? usadoCount / depositadoCount : 0;
  const avgUsedTicket = usadoCount > 0 ? totalPedidoUsado / usadoCount : 0;
  const breakageRate = depositadoCount > 0 ? expirado / depositado : 0;

  return NextResponse.json({
    windowDays,
    counts: { pedidoCount, depositadoCount, usadoCount },
    totals: { emitido, depositado, usado, expirado, ativoNow },
    ratios: { conversionRate, breakageRate, avgUsedTicket },
  });
}
