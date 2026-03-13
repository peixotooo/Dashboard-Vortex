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
  const pageType = searchParams.get("page_type");

  if (!pageType) {
    return NextResponse.json(
      { error: "Missing page_type parameter" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = createAdminClient();

  const { data: configs, error } = await admin
    .from("shelf_configs")
    .select("id, position, anchor_selector, algorithm, title, max_products")
    .eq("workspace_id", auth.workspaceId)
    .eq("page_type", pageType)
    .eq("enabled", true)
    .order("position", { ascending: true });

  if (error) {
    console.error("[Shelves Config]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json(
    { shelves: configs || [] },
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
