import { NextRequest, NextResponse } from "next/server";
import {
  checkBioRateLimit,
  getBioClientIp,
  isValidBioWorkspaceId,
} from "@/lib/bio/security";
import { getBioConfigByWorkspace } from "@/lib/bio/config";
import { buildTrackedDestination, parseUtm, recordBioEvent } from "@/lib/bio/tracking";

function makeSessionId(): string {
  return `bio_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const ip = getBioClientIp(request);
  if (!checkBioRateLimit(`bio_click:${ip}`, 300)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const workspaceId = url.searchParams.get("w") || url.searchParams.get("workspace_id") || "";
  const rawDestination = url.searchParams.get("to") || "";

  if (!workspaceId || !rawDestination || !isValidBioWorkspaceId(workspaceId)) {
    return NextResponse.redirect(new URL("/bio", request.url), 302);
  }

  const config = await getBioConfigByWorkspace(workspaceId).catch(() => null);
  const destination = await buildTrackedDestination({
    workspaceId,
    destinationUrl: rawDestination,
    blockId: url.searchParams.get("block_id"),
    defaultCampaign: config?.default_utm_campaign || null,
    requestUrl: url,
  });

  if (!destination) {
    return NextResponse.redirect(config?.store_base_url || "https://www.bulking.com.br", 302);
  }

  const blockType = url.searchParams.get("block_type");
  const eventName =
    url.searchParams.get("event") ||
    (blockType === "products"
      ? "bio_product_clicked"
      : blockType === "categories"
        ? "bio_category_clicked"
        : blockType === "group"
          ? "bio_group_clicked"
          : blockType === "club"
            ? "bio_club_clicked"
            : blockType === "shipping"
              ? "bio_shipping_clicked"
              : "bio_cta_clicked");

  const sessionId = request.cookies.get("bkg_bio_session")?.value || makeSessionId();
  const utm = parseUtm(url);

  await recordBioEvent({
    workspaceId,
    eventName,
    sessionId,
    blockId: url.searchParams.get("block_id"),
    blockType,
    destinationUrl: destination,
    productId: url.searchParams.get("product_id"),
    category: url.searchParams.get("category"),
    campaignId: url.searchParams.get("campaign_id"),
    referrer: request.headers.get("referer"),
    userAgent: request.headers.get("user-agent"),
    source: utm.source || "instagram",
    medium: utm.medium || "bio",
    campaign: utm.campaign || config?.default_utm_campaign || "instagram_bio",
    content: utm.content || url.searchParams.get("block_id"),
  });

  const response = NextResponse.redirect(destination, 302);
  response.cookies.set("bkg_bio_session", sessionId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: false,
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
