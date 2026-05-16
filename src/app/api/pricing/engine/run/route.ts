// POST /api/pricing/engine/run — roda o engine e persiste decisões.
//
// Diferente do /preview, este persiste em sku_pricing_history (status='pending'
// quando require_approval=true, senão 'approved'). Usado pela tela de config
// pra rodar manualmente sem esperar o cron.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/pricing/supabase";
import { runOrchestrator } from "@/lib/pricing/orchestrator";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const skus: string[] | undefined = Array.isArray(body.skus) ? body.skus : undefined;

    const result = await runOrchestrator(auth.supabase, auth.workspaceId, { skus });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
