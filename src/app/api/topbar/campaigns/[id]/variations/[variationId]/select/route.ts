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

export async function POST(request: NextRequest, ctx: RouteCtx) {
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

  const { data: variation, error: vErr } = await admin
    .from("topbar_variations")
    .select("*")
    .eq("id", variationId)
    .eq("campaign_id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!variation) return NextResponse.json({ error: "Variation not found" }, { status: 404 });

  // Desmarca todas as outras
  await admin
    .from("topbar_variations")
    .update({ selected: false })
    .eq("campaign_id", id)
    .neq("id", variationId);

  // Marca essa como selecionada
  await admin
    .from("topbar_variations")
    .update({ selected: true })
    .eq("id", variationId);

  // Espelha no campaign (denormaliza pra o serving ficar barato)
  const { data: campaign, error: cErr } = await admin
    .from("topbar_campaigns")
    .update({
      message: variation.message,
      link_label: variation.link_label ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  return NextResponse.json({ campaign, variation });
}
