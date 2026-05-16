// POST /api/pricing/composition — dry-run de composição (preview sem persistir).
//
// Recebe inputs brutos no body, devolve preco_minimo, preco_alvo, custos_variaveis
// e (opcional) margem_atual_brl/pct se preco_praticado for fornecido.

import { NextRequest, NextResponse } from "next/server";
import { computeComposition } from "@/lib/pricing/composition";
import { requireAuth } from "@/lib/pricing/supabase";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const input = {
      cogs: Number(body.cogs ?? 0),
      frete_unitario: Number(body.frete_unitario ?? 0),
      marketing_unitario: Number(body.marketing_unitario ?? 0),
      rateio_fixo: Number(body.rateio_fixo ?? 0),
      taxas_comissoes_pct: Number(body.taxas_comissoes_pct ?? 0),
      impostos_pct: Number(body.impostos_pct ?? 0),
      margem_alvo_pct: Number(body.margem_alvo_pct ?? 0),
    };
    const precoPraticado =
      body.preco_praticado != null ? Number(body.preco_praticado) : null;

    const calc = computeComposition(input, precoPraticado);
    return NextResponse.json({
      input,
      preco_praticado: precoPraticado,
      calc: {
        ...calc,
        preco_minimo: Number.isFinite(calc.preco_minimo) ? calc.preco_minimo : null,
        preco_alvo: Number.isFinite(calc.preco_alvo) ? calc.preco_alvo : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
