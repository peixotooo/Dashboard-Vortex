// POST /api/pricing/engine/run — enfileira o engine e persiste decisões via worker.
//
// Diferente do /preview, este gera decisões persistidas. Como o processamento
// varre estoque/vendas em lote, a rota web apenas coloca o job no Droplet.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/pricing/supabase";
import { enqueuePricingEngineRunJob } from "@/lib/pricing/jobs";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const skus: string[] | undefined = Array.isArray(body.skus) ? body.skus : undefined;

    const job = await enqueuePricingEngineRunJob({
      client: auth.supabase,
      workspaceId: auth.workspaceId,
      requestedBy: auth.userId,
      skus,
    });

    return NextResponse.json({
      queued: true,
      job_id: job.jobId,
      job_status: job.status,
      already_queued: job.alreadyQueued,
      skus: job.skus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
