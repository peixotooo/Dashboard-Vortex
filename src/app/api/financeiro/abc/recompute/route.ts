// src/app/api/financeiro/abc/recompute/route.ts
//
// POST /api/financeiro/abc/recompute
//
// Recomputa apenas o snapshot ABC (sem mexer em RFM, cohort, etc).
// Usado pelo seletor de janela na página /financeiro — trocar 30→90d
// não deveria forçar re-cálculo de RFM, que é caro.
//
// Body / query: period_days = 7|14|30|60|90 (default 30).
//
// Carrega crm_vendas paginado (igual o crm-compute faz pra RFM) e
// passa pra recomputeAbcSnapshot. Best-effort no error path: se algo
// falha, devolve 500 com a mensagem.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  recomputeAbcSnapshot,
  ABC_ALLOWED_PERIODS,
  ABC_PERIOD_DAYS_DEFAULT,
} from "@/lib/financeiro/recompute";
import type { CrmVendaRow } from "@/lib/crm-rfm";

export const maxDuration = 300;

const PAGE_SIZE = 1000;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

function parsePeriodDays(value: string | null | undefined): number {
  const n = parseInt(value ?? "", 10);
  if (Number.isFinite(n) && (ABC_ALLOWED_PERIODS as readonly number[]).includes(n)) {
    return n;
  }
  return ABC_PERIOD_DAYS_DEFAULT;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

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
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[financeiro/abc/recompute] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
