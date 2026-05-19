import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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

/**
 * DELETE /api/topbar/campaigns/[id]/variations?source=llm
 * Limpa em massa. Sem ?source, apaga todas. Com source=llm/human, filtra.
 */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { id } = await ctx.params;
  const source = new URL(request.url).searchParams.get("source");
  const admin = createAdminClient();

  let query = admin
    .from("topbar_variations")
    .delete()
    .eq("campaign_id", id)
    .eq("workspace_id", workspaceId);

  if (source === "llm" || source === "human") {
    query = query.eq("generated_by", source);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
