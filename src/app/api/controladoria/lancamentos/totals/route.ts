import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { computeEntryTotals } from "@/lib/controladoria/entry-filters";

export const maxDuration = 60;

// GET /api/controladoria/lancamentos/totals?<mesmos filtros da lista>
// Totais (entradas/saídas/saldo) do conjunto filtrado inteiro — separado da
// rota de linhas para a tabela nunca esperar a soma (72k linhas ~3s frio,
// instantâneo com cache).
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const totals = await computeEntryTotals(createAdminClient(), workspaceId, request.nextUrl.searchParams);
    return NextResponse.json({ totals });
  } catch (err) {
    return handleAuthError(err);
  }
}
