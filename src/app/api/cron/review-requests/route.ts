import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { runRulerForWorkspace } from "@/lib/reviews/ruler";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron da régua de avaliações: enfileira pedidos a partir de compras
// confirmadas (crm_vendas) e dispara os vencidos (WhatsApp/email) + lembretes.
// Roda para todo workspace com review_settings.request_enabled = true.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: enabled } = await admin
    .from("review_settings")
    .select("workspace_id")
    .eq("request_enabled", true);

  const workspaceIds = Array.from(new Set((enabled || []).map((r) => r.workspace_id as string)));
  const results: Record<string, unknown> = {};

  for (const wsId of workspaceIds) {
    try {
      results[wsId] = await runRulerForWorkspace(wsId, admin);
    } catch (e) {
      results[wsId] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, workspaces: workspaceIds.length, results });
}
