import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { processPricingJobs } from "@/lib/pricing/jobs";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const engineLimit = clampParam(request.nextUrl.searchParams.get("engine_limit"), 1, 5, 1);
  const applyBatchLimit = clampParam(
    request.nextUrl.searchParams.get("apply_batch_limit"),
    1,
    100,
    20
  );
  const hubBatchLimit = clampParam(
    request.nextUrl.searchParams.get("hub_batch_limit"),
    1,
    100,
    25
  );

  const admin = createAdminClient();
  const summary = await processPricingJobs(admin, {
    engineLimit,
    applyBatchLimit,
    hubBatchLimit,
  });

  return NextResponse.json({
    ok: true,
    ...summary,
  });
}

function clampParam(value: string | null, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
