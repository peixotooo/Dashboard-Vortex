import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  enqueueHubBulkPriceJob,
  PricingJobValidationError,
  type BulkPriceField,
  type BulkPriceOperation,
} from "@/lib/pricing/jobs";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(req));
  } catch (error) {
    return handleAuthError(error);
  }

  const body = await req.json();
  const {
    ids,
    ml_category_id,
    operation,
    value,
    field = "preco",
    push_to_ml = true,
  } = body as {
    ids?: string[];
    ml_category_id?: string;
    operation: BulkPriceOperation;
    value: number;
    field: BulkPriceField;
    push_to_ml?: boolean;
  };

  const supabase = createAdminClient();

  try {
    const job = await enqueueHubBulkPriceJob({
      client: supabase,
      workspaceId,
      ids,
      mlCategoryId: ml_category_id,
      operation,
      value: Number(value),
      field,
      pushToMl: push_to_ml !== false,
    });

    return NextResponse.json({
      queued: true,
      job_id: job.jobId,
      job_status: job.status,
      already_queued: job.alreadyQueued,
      matched: job.matched,
      updated: 0,
      ml_synced: 0,
      errors: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao enfileirar";
    return NextResponse.json(
      { error: message },
      { status: err instanceof PricingJobValidationError ? 400 : 500 }
    );
  }
}
