// src/app/api/financeiro/abc/recompute/route.ts
//
// POST /api/financeiro/abc/recompute
//
// Recomputa apenas o snapshot ABC (sem mexer em RFM, cohort, etc).
// Usado pelo seletor de janela na página /financeiro — trocar 30→90d
// não deveria forçar re-cálculo de RFM, que é caro.
//
// Body / query: period_days = integer 1..365 (default 30).
//
// Carrega crm_vendas paginado (igual o crm-compute faz pra RFM) e
// passa pra recomputeAbcSnapshot. Best-effort no error path: se algo
// falha, devolve 500 com a mensagem.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  recomputeAbcSnapshot,
  ABC_PERIOD_DAYS_DEFAULT,
  ABC_PERIOD_DAYS_MAX,
  ABC_PERIOD_DAYS_MIN,
} from "@/lib/financeiro/recompute";
import type { CrmVendaRow } from "@/lib/crm-rfm";

export const maxDuration = 300;

const PAGE_SIZE = 1000;

function parsePeriodDays(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw) return ABC_PERIOD_DAYS_DEFAULT;
  if (!/^\d+$/.test(raw)) return ABC_PERIOD_DAYS_DEFAULT;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= ABC_PERIOD_DAYS_MIN && n <= ABC_PERIOD_DAYS_MAX) {
    return n;
  }
  return ABC_PERIOD_DAYS_DEFAULT;
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    let bodyPeriod: string | null = null;
    try {
      const body = (await request.json()) as { period_days?: number | string };
      if (body?.period_days != null) bodyPeriod = String(body.period_days);
    } catch {
      // body opcional
    }
    const periodDays = parsePeriodDays(
      bodyPeriod ?? request.nextUrl.searchParams.get("period_days")
    );

    const admin = createAdminClient();

    // Filtra crm_vendas pelo SQL — a recompute só precisa do período
    // pedido (e.g., 7d). Sem isso, Bulking carregava 80k+ rows pra
    // calcular 7d e estourava o timeout da Vercel.
    const cutoff = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const allRows: CrmVendaRow[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await admin
        .from("crm_vendas")
        .select(
          "cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores, items, payment_method, installments, shipping_price, discount_price, source_order_id"
        )
        .eq("workspace_id", workspaceId)
        .gte("data_compra", cutoff)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (data && data.length > 0) {
        allRows.push(...(data as CrmVendaRow[]));
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    await recomputeAbcSnapshot(admin, workspaceId, allRows, periodDays);

    return NextResponse.json({
      ok: true,
      period_days: periodDays,
      row_count_total: allRows.length,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      return handleAuthError(err);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[financeiro/abc/recompute] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
