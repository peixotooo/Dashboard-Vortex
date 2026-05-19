import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateCampaignVariations } from "@/lib/topbar/generate";

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

type RouteCtx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  try {
    const variations = await generateCampaignVariations({
      workspaceId,
      campaignId: id,
      count: body.count,
      model: body.model,
    });
    return NextResponse.json({ variations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
