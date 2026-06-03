import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncGiftRequestConversions } from "@/lib/gift-request/conversions";
import { enqueueGiftRequestFollowups } from "@/lib/gift-request/followups";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

  const [configRes, requestRes] = await Promise.all([
    admin
      .from("gift_request_configs")
      .select("workspace_id")
      .eq("enabled", true),
    admin
      .from("gift_requests")
      .select("workspace_id")
      .is("converted_at", null)
      .gte("created_at", cutoff),
  ]);

  if (configRes.error) {
    return NextResponse.json(
      { error: configRes.error.message },
      { status: 500 }
    );
  }
  if (requestRes.error) {
    return NextResponse.json(
      { error: requestRes.error.message },
      { status: 500 }
    );
  }

  const workspaceIds = Array.from(
    new Set(
      [
        ...(configRes.data || []).map((row) => row.workspace_id as string),
        ...(requestRes.data || []).map((row) => row.workspace_id as string),
      ].filter(Boolean)
    )
  );

  const summary = [];
  for (const workspaceId of workspaceIds) {
    try {
      const conversions = await syncGiftRequestConversions({
        admin,
        workspaceId,
      });
      const followups = await enqueueGiftRequestFollowups({
        admin,
        workspaceId,
      });
      summary.push({ workspaceId, conversions, followups });
      console.log(
        `[GiftRequestConversions] ws=${workspaceId} scanned=${conversions.scanned} matched=${conversions.matched} updated=${conversions.updated} revenue=${conversions.totalRevenue} followupsQueued=${followups.queued} followupsSkipped=${followups.skipped} followupsCanceled=${followups.canceled}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.push({
        workspaceId,
        error: message,
      });
      console.error(`[GiftRequestConversions] ws=${workspaceId} failed:`, err);
    }
  }

  return NextResponse.json({
    processed: summary.length,
    summary,
  });
}
