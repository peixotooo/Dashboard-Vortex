import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isMissingBioTable } from "@/lib/bio/config";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get("days")) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("bio_page_events")
      .select("event_name, block_id, block_type, product_id, category, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      if (isMissingBioTable(error)) {
        return NextResponse.json({
          totals: { views: 0, clicks: 0, ctr: 0 },
          by_event: {},
          top_blocks: [],
          days,
        });
      }
      console.error("[bio metrics] query failed", error.message);
      return NextResponse.json({ error: "Failed to load bio metrics" }, { status: 500 });
    }

    const byEvent: Record<string, number> = {};
    const byBlock = new Map<string, { block_id: string; block_type: string | null; clicks: number }>();
    let views = 0;
    let clicks = 0;

    for (const row of data || []) {
      const event = String(row.event_name || "");
      byEvent[event] = (byEvent[event] || 0) + 1;
      if (event === "bio_viewed") views += 1;
      if (event.endsWith("_clicked")) {
        clicks += 1;
        const blockId = String(row.block_id || "sem_bloco");
        const current = byBlock.get(blockId) || { block_id: blockId, block_type: row.block_type || null, clicks: 0 };
        current.clicks += 1;
        byBlock.set(blockId, current);
      }
    }

    return NextResponse.json({
      totals: {
        views,
        clicks,
        ctr: views > 0 ? Number(((clicks / views) * 100).toFixed(2)) : 0,
      },
      by_event: byEvent,
      top_blocks: [...byBlock.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 10),
      days,
    });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse.status < 500) return authResponse;
    console.error("[bio metrics] GET failed", error);
    return NextResponse.json({ error: "Failed to load bio metrics" }, { status: 500 });
  }
}
