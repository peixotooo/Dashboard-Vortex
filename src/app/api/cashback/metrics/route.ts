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

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const windowDays = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") || 30)));
  const since = windowStart(windowDays);

  const { data: rows, error: dbErr } = await auth!.admin
    .from("cashback_transactions")
    .select("status, valor_cashback, valor_pedido, confirmado_em, depositado_em, usado_em, estornado_em")
    .eq("workspace_id", auth!.workspaceId)
    .gte("confirmado_em", since);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  const transactions = (rows as Row[]) || [];

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
