import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const {
    key,
    session_id,
    consumer_id,
    event_type,
    product_id,
    page_type,
    shelf_config_id,
    revenue,
  } = body as Record<string, string | number | undefined>;

  if (!session_id || !event_type) {
    return NextResponse.json(
      { error: "Missing session_id or event_type" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const auth = await validateApiKey(key as string);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = createAdminClient();

  try {
    // Insert event
    await admin.from("shelf_events").insert({
      workspace_id: auth.workspaceId,
      session_id,
      consumer_id: consumer_id || null,
      event_type,
      product_id: product_id || null,
      page_type: page_type || null,
      shelf_config_id: shelf_config_id || null,
      revenue: revenue || null,
    });

    // Update consumer history on pageview
    if (
      event_type === "pageview" &&
      product_id &&
      consumer_id
    ) {
      await admin.from("shelf_consumer_history").upsert(
        {
          workspace_id: auth.workspaceId,
          consumer_id: consumer_id as string,
          product_id: product_id as string,
          views: 1,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "workspace_id,consumer_id,product_id" }
      );

      // Increment views for existing records
      try {
        await admin.rpc("increment_shelf_views", {
          p_workspace_id: auth.workspaceId,
          p_consumer_id: consumer_id,
          p_product_id: product_id,
        });
      } catch {
        // RPC may not exist yet, upsert above handles the insert case
      }
    }

    return NextResponse.json(
      { ok: true },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Shelves Track]", error);
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
