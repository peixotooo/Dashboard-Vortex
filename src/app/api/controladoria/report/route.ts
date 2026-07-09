import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchEngineData, aggregateYear, composeDre, composeDfc, composePeriod,
  type StatusFilter,
} from "@/lib/controladoria/engine";

export const maxDuration = 60;

// GET /api/controladoria/report?view=dre|dfc|dashboard
//   dre/dfc:    &year=2026&level=resumido|expandido&status=todos|pagos|pendentes
//   dashboard:  &from=2026-07-01&to=2026-07-31
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const p = request.nextUrl.searchParams;
    const view = p.get("view") ?? "dashboard";
    const supabase = createAdminClient();

    const accounts = p.get("accounts")?.split(",").filter(Boolean);
    const { entries, classifications } = await fetchEngineData(supabase, workspaceId, {
      accountIds: accounts,
    });

    if (view === "dashboard") {
      const now = new Date();
      const from = p.get("from") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const to = p.get("to") ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const { data: settings } = await supabase
        .from("fin_settings")
        .select("goals")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const goals = settings?.goals ?? {};
      const status = (p.get("status") ?? "todos") as StatusFilter;
      const summary = composePeriod(entries, classifications, from, to, goals, status);
      return NextResponse.json({ from, to, ...summary, goals });
    }

    const year = parseInt(p.get("year") ?? String(new Date().getFullYear()), 10);
    const level = p.get("level") ?? "resumido";
    const status = (p.get("status") ?? "todos") as StatusFilter;
    const agg = aggregateYear(entries, year, status, classifications);

    if (view === "dre") {
      return NextResponse.json({ year, level, lines: composeDre(agg, classifications, level === "expandido") });
    }
    if (view === "dfc") {
      const dfc = composeDfc(agg, classifications, level === "expandido");
      return NextResponse.json({
        year, level,
        entradas: agg.dfcEntradas,
        saidas: agg.dfcSaidas,
        liquidez: agg.dfcEntradas.map((e, m) => e - agg.dfcSaidas[m]),
        saldoAcumulado: dfc.saldoFinal,
        saldoInicial: dfc.saldoInicial,
        lines: dfc.lines,
      });
    }
    return NextResponse.json({ error: "view inválida" }, { status: 400 });
  } catch (err) {
    return handleAuthError(err);
  }
}
