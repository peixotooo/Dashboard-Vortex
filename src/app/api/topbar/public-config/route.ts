import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveActiveCampaign } from "@/lib/topbar/resolve";
import { normalizeTopbarSlides } from "@/lib/topbar/slides";

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

  // Helpers de merge: campanha vence config; null/undefined herda
  const c = campaign as unknown as Record<string, unknown>;
  const pickStr = (key: string, fallback: string | null = null): string | null => {
    const camp = c[key];
    if (typeof camp === "string" && camp.length > 0) return camp;
    const cfg = (config as Record<string, unknown>)[key];
    if (typeof cfg === "string" && cfg.length > 0) return cfg;
    return fallback;
  };
  const pickBool = (key: string, fallback: boolean): boolean => {
    const camp = c[key];
    if (typeof camp === "boolean") return camp;
    const cfg = (config as Record<string, unknown>)[key];
    if (typeof cfg === "boolean") return cfg;
    return fallback;
  };

  const campaignSlides = normalizeTopbarSlides(
    (campaign as { slides?: unknown }).slides,
    (campaign as { title?: string | null }).title || null,
    campaign.message
  );
  const variationIsActive = Boolean(selectedVar && campaignSlides.length <= 1);
  const slides = variationIsActive
    ? normalizeTopbarSlides(null, (campaign as { title?: string | null }).title || null, selectedVar?.message)
    : campaignSlides;
  const primarySlide = slides[0] || {
    title: (campaign as { title?: string | null }).title || null,
    message: selectedVar?.message || campaign.message,
  };

  return NextResponse.json(
    {
      topbar: {
        // Style: campanha sobrescreve config (com fallback hard-coded)
        bg_color: pickStr("bg_color", "#0f172a"),
        text_color: pickStr("text_color", "#ffffff"),
        accent_color: pickStr("accent_color", "#22c55e"),
        font_size: pickStr("font_size", "14px"),
        height: pickStr("height", "40px"),
        title_bold: pickBool("title_bold", true),
        message_bold: pickBool("message_bold", false),
        sticky: config.sticky,
        position: config.position,
        show_close_button: config.show_close_button,
        close_persistence_hours: config.close_persistence_hours,
        // Conteúdo
        campaign_id: campaign.id,
        variation_id: variationIsActive ? selectedVar?.id || null : null,
        title: primarySlide.title || null,
        message: primarySlide.message,
        slides,
        link_url: campaign.link_url,
        link_label: variationIsActive ? selectedVar?.link_label || campaign.link_label : campaign.link_label,
        // Countdown
        countdown_enabled: campaign.countdown_enabled,
        countdown_target: countdownTarget,
        countdown_label: campaign.countdown_label,
        countdown_bg_color: pickStr("countdown_bg_color", "rgba(255,255,255,.14)"),
        countdown_text_color: pickStr("countdown_text_color"), // null = herda text_color no front
        countdown_font_weight: pickStr("countdown_font_weight", "600"),
        countdown_padding: pickStr("countdown_padding", "3px 10px"),
        countdown_border_radius: pickStr("countdown_border_radius", "999px"),
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
