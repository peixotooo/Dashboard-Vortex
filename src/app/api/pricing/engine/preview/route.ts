// POST /api/pricing/engine/preview — dry-run do engine.
//
// Roda o orchestrator com dryRun=true e devolve a lista de decisões sem
// persistir em sku_pricing_history. Útil pra UI mostrar "que decisões o cron
// tomaria agora" sem disparar o ciclo.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";
import { runOrchestrator } from "@/lib/pricing/orchestrator";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const skus: string[] | undefined = Array.isArray(body.skus) ? body.skus : undefined;

    const result = await runOrchestrator(auth.supabase, auth.workspaceId, {
      dryRun: true,
      skus,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
