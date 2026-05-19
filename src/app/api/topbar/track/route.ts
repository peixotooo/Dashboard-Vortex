import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VALID_EVENTS = new Set(["impression", "click", "close"]);

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !VALID_EVENTS.has(body.event_type)) {
    return NextResponse.json(
      { error: "Invalid event" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();

  await admin.from("topbar_events").insert({
    workspace_id: auth.workspaceId,
    campaign_id: body.campaign_id || null,
    variation_id: body.variation_id || null,
    event_type: body.event_type,
    page_type: body.page_type || null,
    session_id: body.session_id || null,
  });

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
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
