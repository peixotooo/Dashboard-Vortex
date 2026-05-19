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

type RouteCtx = { params: Promise<{ id: string; variationId: string }> };

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { id, variationId } = await ctx.params;
  const admin = createAdminClient();

  const { error } = await admin
    .from("topbar_variations")
    .delete()
    .eq("id", variationId)
    .eq("campaign_id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
