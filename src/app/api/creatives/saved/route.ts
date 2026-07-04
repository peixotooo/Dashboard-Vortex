import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
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
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

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
    return handleAuthError(error);
  }
}
