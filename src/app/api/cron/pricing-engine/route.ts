// Cron diário do engine de pricing.
//
// Schedule (vercel.json): "0 5 * * *" — 5h UTC, antes do shelf-catalog-sync 6h.
//
// Para cada workspace com pricing_engine_settings.enabled=true:
//   - Se cadencia='diaria', sempre roda.
//   - Se cadencia='semanal', roda apenas no dia da semana configurado.
//
// O orchestrator gera linhas em sku_pricing_history (status='pending' por
// default). Aplicação na VNDA acontece manualmente via /api/pricing/engine/apply
// (mesmo padrão do promo_coupon_plans com require_manual_approval).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runOrchestrator, loadEngineSettings } from "@/lib/pricing/orchestrator";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: workspaces, error } = await admin
    .from("pricing_engine_settings")
    .select("workspace_id, enabled, cadencia, cadencia_dia_semana")
    .eq("enabled", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const todayDow = new Date().getUTCDay(); // 0=domingo
  const results: Array<{ workspace_id: string; evaluated: number; error?: string }> = [];

  for (const ws of workspaces ?? []) {
    if (ws.cadencia === "semanal" && ws.cadencia_dia_semana !== todayDow) {
      continue;
    }
    try {
      // loadEngineSettings novamente pra pegar a config completa (a query
      // anterior só selecionou colunas mínimas pra decidir se roda).
      await loadEngineSettings(admin, ws.workspace_id);
      const result = await runOrchestrator(admin, ws.workspace_id);
      results.push({
        workspace_id: ws.workspace_id,
        evaluated: result.evaluated,
      });
    } catch (err) {
      results.push({
        workspace_id: ws.workspace_id,
        evaluated: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
