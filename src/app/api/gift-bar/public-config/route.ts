import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();

  const [configResult, cashbackResult] = await Promise.all([
    admin
      .from("gift_bar_configs")
      .select(
        "enabled, threshold, gift_name, gift_description, gift_image_url, " +
          "message_progress, message_achieved, message_empty, " +
          "message_next_step, message_all_achieved, " +
          "bar_color, bar_bg_color, text_color, bg_color, " +
          "achieved_bg_color, achieved_text_color, font_size, bar_height, " +
          "position, show_on_pages, steps, " +
          "show_product_benefits, product_benefits, product_benefits_title, product_benefits_anchor, pdp_inline"
      )
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle(),
    admin
      .from("cashback_config")
      .select("percentage")
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle(),
  ]);

  if (configResult.error) {
    console.error("[GiftBar Config]", configResult.error.message);
    return NextResponse.json(
      { error: configResult.error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const giftBar = configResult.data
    ? {
        ...(configResult.data as unknown as Record<string, unknown>),
        // Surface cashback % so the bar can show "Voce ganhara R$ X em cashback"
        cashback_percent: cashbackResult.data?.percentage
          ? Number(cashbackResult.data.percentage)
          : 0,
      }
    : null;

  return NextResponse.json(
    { gift_bar: giftBar },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
