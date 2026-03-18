import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    // Use admin client for shelf_events (RLS restricted)
    const { createAdminClient } = await import("@/lib/supabase-admin");
    const admin = createAdminClient();

    // Get all configs for this workspace
    const { data: configs } = await supabase
      .from("shelf_configs")
      .select("id, page_type, position, algorithm, title, enabled")
      .eq("workspace_id", workspaceId);

    // Get event counts per shelf
    // shelves.js sends "impression" (with shelf_config_id) and "click" (with shelf_config_id)
    const { data: impressionEvents } = await admin
      .from("shelf_events")
      .select("shelf_config_id, event_type")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["impression", "click"])
      .not("shelf_config_id", "is", null)
      .gte("created_at", since);

    // Aggregate per shelf
    const shelfStats = new Map<
      string,
      { impressions: number; clicks: number }
    >();

    for (const event of impressionEvents || []) {
      const id = event.shelf_config_id;
      if (!id) continue;
      const stats = shelfStats.get(id) || { impressions: 0, clicks: 0 };
      if (event.event_type === "impression") stats.impressions++;
      else if (event.event_type === "click") stats.clicks++;
      shelfStats.set(id, stats);
    }

    // Total events
    const { count: totalImpressions } = await admin
      .from("shelf_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("event_type", "impression")
      .not("shelf_config_id", "is", null)
      .gte("created_at", since);

    const { count: totalClicks } = await admin
      .from("shelf_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("event_type", "click")
      .not("shelf_config_id", "is", null)
      .gte("created_at", since);

    // Build per-shelf analytics
    const shelvesAnalytics = (configs || []).map((config) => {
      const stats = shelfStats.get(config.id) || {
        impressions: 0,
        clicks: 0,
      };
      return {
        ...config,
        impressions: stats.impressions,
        clicks: stats.clicks,
        ctr:
          stats.impressions > 0
            ? parseFloat(
                ((stats.clicks / stats.impressions) * 100).toFixed(2)
              )
            : 0,
      };
    });

    const avgCtr =
      (totalImpressions || 0) > 0
        ? (totalClicks || 0) / (totalImpressions || 1)
        : 0;

    return NextResponse.json({
      totalImpressions: totalImpressions || 0,
      totalClicks: totalClicks || 0,
      avgCtr,
      shelves: shelvesAnalytics,
      period: `${days}d`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
