import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { processCouponJobs } from "@/lib/coupons/jobs";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit") || 3);
  const limit = Math.min(10, Math.max(1, Number.isFinite(limitParam) ? limitParam : 3));
  const admin = createAdminClient();
  const summary = await processCouponJobs(admin, limit);

  return NextResponse.json({
    ok: true,
    ...summary,
  });
}
