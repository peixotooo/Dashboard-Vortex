import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { refreshCheckoutSessionRollups } from "@/lib/checkout/rollups";

export const runtime = "nodejs";
export const maxDuration = 60;

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hours = numberParam(searchParams.get("hours"), 48, 1, 24 * 30);
  const maxEvents = numberParam(searchParams.get("max_events"), 100000, 1000, 500000);
  const workspaceId = searchParams.get("workspace_id") || undefined;
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    const admin = createAdminClient();
    const result = await refreshCheckoutSessionRollups(admin, {
      sinceIso,
      workspaceId,
      maxEvents,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[checkout-funnel-aggregate]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
