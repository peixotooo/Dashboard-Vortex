import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeTopbarSlides, serializeTopbarSlides } from "@/lib/topbar/slides";

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

  const { data: currentCampaign, error: currentErr } = await admin
    .from("topbar_campaigns")
    .select("title,message,link_url,link_label")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  if (!currentCampaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

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

  const currentSlides = normalizeTopbarSlides(
    null,
    currentCampaign.title,
    currentCampaign.message,
    {
      fallbackLinkUrl: currentCampaign.link_url,
      fallbackLinkLabel: currentCampaign.link_label,
    }
  );
  const nextSlides = currentSlides.length
    ? currentSlides
    : [
        {
          title: currentCampaign.title,
          message: currentCampaign.message,
          link_url: currentCampaign.link_url,
          link_label: currentCampaign.link_label,
        },
      ];
  nextSlides[0] = {
    ...nextSlides[0],
    message: variation.message,
    link_label: variation.link_label ?? nextSlides[0].link_label ?? null,
  };
  const content = serializeTopbarSlides(
    nextSlides,
    currentCampaign.title,
    variation.message,
    currentCampaign.link_url,
    variation.link_label ?? currentCampaign.link_label
  );

  // Espelha no campaign (denormaliza pra o serving ficar barato) sem apagar slides/estilo.
  const { data: campaign, error: cErr } = await admin
    .from("topbar_campaigns")
    .update({
      title: content.title,
      message: content.message,
      link_url: content.link_url,
      link_label: content.link_label,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  return NextResponse.json({ campaign, variation });
}
