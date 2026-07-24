import { NextRequest, NextResponse } from "next/server";
import {
  buildBioCorsHeaders,
  checkBioRateLimit,
  getBioClientIp,
  isAllowedBioOrigin,
  isValidBioWorkspaceId,
  sanitizeBioMetadata,
} from "@/lib/bio/security";
import { isValidBioEvent, parseUtm, recordBioEvent } from "@/lib/bio/tracking";
import { readLimitedJson } from "@/lib/security/webhook-request";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  const cors = buildBioCorsHeaders(request);

  if (!isAllowedBioOrigin(request)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
  }

  const ip = getBioClientIp(request);
  if (!(await checkBioRateLimit(`bio_track:${ip}`, 240))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: cors });
  }

  const parsedBody = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.error },
      { status: parsedBody.status, headers: cors }
    );
  }
  const body = parsedBody.value as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
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
  if (!isValidBioWorkspaceId(workspaceId)) {
    return NextResponse.json({ error: "Invalid workspace_id" }, { status: 400, headers: cors });
  }
  if (!isValidBioEvent(eventName)) {
    return NextResponse.json({ error: "Invalid event_name" }, { status: 400, headers: cors });
  }
  if (!(await checkBioRateLimit(`bio_track:${ip}:${workspaceId}`, 120))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: cors });
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
    metadata: sanitizeBioMetadata(body.metadata),
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}

export async function OPTIONS(request: NextRequest) {
  const cors = buildBioCorsHeaders(request);
  if (!isAllowedBioOrigin(request)) {
    return new NextResponse(null, { status: 403, headers: cors });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Max-Age": "86400",
    },
  });
}
