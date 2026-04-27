import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncAttributionForWorkspace } from "@/lib/coupons/attribution";
import { recomputeBanditStats } from "@/lib/coupons/bandit";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Workspaces that have at least one coupon worth syncing (active/expired/paused
  // in last 30 days). Avoid scanning workspaces with zero coupons.
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: rows } = await admin
    .from("promo_active_coupons")
    .select("workspace_id")
    .in("status", ["active", "expired", "paused"])
    .gte("starts_at", cutoff);

  const workspaceIds = Array.from(new Set((rows || []).map((r) => r.workspace_id as string)));
  if (workspaceIds.length === 0) {
    return NextResponse.json({ processed: 0, message: "No coupons to attribute" });
  }

  const summary = [];
  for (const wsId of workspaceIds) {
    try {
      const r = await syncAttributionForWorkspace(wsId);
      // After fresh attribution, refresh the bandit so smart plans see current stats
      await recomputeBanditStats(wsId);
      summary.push(r);
      console.log(
        `[CouponAttribution] ws=${wsId} scanned=${r.scanned} updated=${r.updated} revenue=${r.totalRevenue} units=${r.totalUnits}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.push({ workspaceId: wsId, scanned: 0, updated: 0, totalRevenue: 0, totalUnits: 0, error: msg });
      console.error(`[CouponAttribution] ws=${wsId} failed:`, msg);
    }
  }

  return NextResponse.json({ processed: summary.length, summary });
}
