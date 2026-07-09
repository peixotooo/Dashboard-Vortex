import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncAutoRevenue, type AutoRevenueConfig } from "@/lib/controladoria/auto-revenue";

export const maxDuration = 120;

// Cron diário (manhã BRT): lança as receitas agregadas de ontem (VNDA + ML)
// e re-verifica a janela recente (cancelamentos/pedidos tardios).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin.from("fin_settings").select("workspace_id, cash_planning");
  const enabled = (rows ?? []).filter((r) => ((r.cash_planning as { auto_receitas?: AutoRevenueConfig })?.auto_receitas)?.enabled);

  const report: Array<{ workspaceId: string; summary: string; error?: string }> = [];
  for (const row of enabled) {
    try {
      const { summary } = await syncAutoRevenue(row.workspace_id);
      report.push({ workspaceId: row.workspace_id, summary });
    } catch (e) {
      report.push({ workspaceId: row.workspace_id, summary: "falhou", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ workspaces: enabled.length, report });
}
