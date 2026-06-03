import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncGiftRequestConversions } from "@/lib/gift-request/conversions";

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
      const result = await syncGiftRequestConversions({ admin, workspaceId });
      summary.push(result);
      console.log(
        `[GiftRequestConversions] ws=${workspaceId} scanned=${result.scanned} matched=${result.matched} updated=${result.updated} revenue=${result.totalRevenue}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.push({
        workspaceId,
        scanned: 0,
        matched: 0,
        updated: 0,
        skipped: 0,
        totalRevenue: 0,
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
