import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { listSavedCreatives, getSavedCreativeTiers } from "@/lib/agent/memory";

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

// GET /api/creatives/saved?tier=champion&format=video&min_roas=2
// GET /api/creatives/saved?tiers_only=true  (lightweight for frontend badges)
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const url = new URL(request.url);

    // Lightweight mode: just return tier map
    if (url.searchParams.get("tiers_only") === "true") {
      const tiers = await getSavedCreativeTiers(supabase, workspaceId);
      return NextResponse.json({ tiers });
    }

    const tagsParam = url.searchParams.get("tags");
    const filters = {
      tier: url.searchParams.get("tier") || undefined,
      tags: tagsParam ? tagsParam.split(",") : undefined,
      format: url.searchParams.get("format") || undefined,
      min_roas: url.searchParams.get("min_roas")
        ? parseFloat(url.searchParams.get("min_roas")!)
        : undefined,
      account_id: url.searchParams.get("account_id") || undefined,
    };

    const creatives = await listSavedCreatives(supabase, workspaceId, filters);
    return NextResponse.json({ creatives, count: creatives.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
