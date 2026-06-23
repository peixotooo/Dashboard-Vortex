import { NextRequest, NextResponse } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";
import { parseUtm, recordBioEvent } from "@/lib/bio/tracking";

export async function POST(request: NextRequest) {
  const cors = buildCorsHeaders(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  }

  const workspaceId = String(body.workspace_id || "");
  const eventName = String(body.event_name || "");
  if (!workspaceId || !eventName) {
    return NextResponse.json(
      { error: "workspace_id and event_name are required" },
      { status: 400, headers: cors }
    );
  }

  const url = new URL(request.url);
  const utm = parseUtm(url);

  await recordBioEvent({
    workspaceId,
    eventName,
    sessionId: typeof body.session_id === "string" ? body.session_id : null,
    blockId: typeof body.block_id === "string" ? body.block_id : null,
    blockType: typeof body.block_type === "string" ? body.block_type : null,
    destinationUrl: typeof body.destination_url === "string" ? body.destination_url : null,
    productId: typeof body.product_id === "string" ? body.product_id : null,
    category: typeof body.category === "string" ? body.category : null,
    campaignId: typeof body.campaign_id === "string" ? body.campaign_id : null,
    referrer: request.headers.get("referer"),
    userAgent: request.headers.get("user-agent"),
    source: typeof body.utm_source === "string" ? body.utm_source : utm.source,
    medium: typeof body.utm_medium === "string" ? body.utm_medium : utm.medium,
    campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : utm.campaign,
    content: typeof body.utm_content === "string" ? body.utm_content : utm.content,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : null,
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...buildCorsHeaders(request),
      "Access-Control-Max-Age": "86400",
    },
  });
}
