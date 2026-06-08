// POST /api/pricing/engine/apply — enfileira aplicação de decisões aprovadas na VNDA.
//
// Body: { ids?: string[] }  (default: todas com status='approved' no workspace)
//
// A rota web nao faz PATCH na VNDA. Ela captura as decisoes aprovadas atuais e
// o Droplet processa em lotes pequenos para evitar timeout/duplicidade.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/pricing/supabase";
import { enqueuePricingApplyJob } from "@/lib/pricing/jobs";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const ids: string[] | null = Array.isArray(body.ids) ? body.ids : null;

    const job = await enqueuePricingApplyJob({
      client: auth.supabase,
      workspaceId: auth.workspaceId,
      requestedBy: auth.userId,
      ids,
    });

    if (job.matched === 0) {
      return NextResponse.json({
        queued: false,
        applied: 0,
        failed: 0,
        items: [],
        message: "Nenhuma decisao aprovada para aplicar.",
      });
    }

    return NextResponse.json({
      queued: true,
      job_id: job.jobId,
      job_status: job.status,
      already_queued: job.alreadyQueued,
      matched: job.matched,
      applied: 0,
      failed: 0,
      items: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
