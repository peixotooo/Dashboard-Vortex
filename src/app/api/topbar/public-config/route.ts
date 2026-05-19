import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveActiveCampaign } from "@/lib/topbar/resolve";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const pageType = (searchParams.get("page_type") || "other").toLowerCase();

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from("topbar_configs")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Sem config ou desabilitado → não renderiza
  if (!config || !config.enabled) {
    return NextResponse.json(
      { topbar: null },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  // Guard: páginas em hide_on_pages (cart/checkout sempre incluídas)
  const hideOn: string[] = config.hide_on_pages || ["cart", "checkout"];
  if (hideOn.includes(pageType)) {
    return NextResponse.json(
      { topbar: null, reason: "page_hidden" },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  // Resolve campanha ativa
  const resolved = await resolveActiveCampaign(auth.workspaceId, pageType);
  if (!resolved) {
    return NextResponse.json(
      { topbar: null, reason: "no_active_campaign" },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }

  const { campaign, countdownTarget } = resolved;

  // Variação selecionada (pode não existir; fallback no message do campaign)
  const { data: selectedVar } = await admin
    .from("topbar_variations")
    .select("id, message, link_label")
    .eq("campaign_id", campaign.id)
    .eq("selected", true)
    .maybeSingle();

  return NextResponse.json(
    {
      topbar: {
        // Style: campanha sobrescreve config
        bg_color: campaign.bg_color || config.bg_color,
        text_color: campaign.text_color || config.text_color,
        accent_color: campaign.accent_color || config.accent_color,
        font_size: config.font_size,
        height: config.height,
        sticky: config.sticky,
        position: config.position,
        show_close_button: config.show_close_button,
        close_persistence_hours: config.close_persistence_hours,
        // Conteúdo
        campaign_id: campaign.id,
        variation_id: selectedVar?.id || null,
        title: (campaign as { title?: string | null }).title || null,
        message: selectedVar?.message || campaign.message,
        link_url: campaign.link_url,
        link_label: selectedVar?.link_label || campaign.link_label,
        // Countdown
        countdown_enabled: campaign.countdown_enabled,
        countdown_target: countdownTarget,
        countdown_label: campaign.countdown_label,
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}
