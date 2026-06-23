import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { isMissingBioTable } from "@/lib/bio/config";

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

async function authenticate(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return { error: "Workspace not specified", status: 400 as const };

  return { workspaceId };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get("days")) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("bio_page_events")
      .select("event_name, block_id, block_type, product_id, category, created_at")
      .eq("workspace_id", auth.workspaceId)
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
