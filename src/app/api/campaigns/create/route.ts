import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AuthError, getAuthenticatedContext, handleAuthError, requireMetaTokenForRequest } from "@/lib/api-auth";
import {
  createCampaign,
  createAdSet,
  uploadAdImage,
  createAdCreative,
  createAd,
  runWithToken,
} from "@/lib/meta-api";

export const maxDuration = 60;

const DEFAULT_URL_TAGS =
  "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}";
const MAX_CREATIVE_BYTES = 10 * 1024 * 1024;

function isPrivateIp(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  const version = isIP(host);

  if (version === 4) {
    const parts = host.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (version === 6) {
    const normalized = host.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

async function validateExternalUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("creative_url must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("creative_url must use http or https");
  }

  if (url.username || url.password) {
    throw new Error("creative_url must not include credentials");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("creative_url must point to a public host");
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error("creative_url resolved to a private network address");
  }

  return url;
}

async function fetchCreativeImage(rawUrl: string): Promise<Response> {
  let currentUrl = await validateExternalUrl(rawUrl);

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(currentUrl.toString(), { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("creative_url redirected without a location");
      currentUrl = await validateExternalUrl(new URL(location, currentUrl).toString());
      continue;
    }

    return response;
  }

  throw new Error("creative_url redirected too many times");
}

export async function POST(request: NextRequest) {
  // Track created IDs for error context
  let campaignId: string | undefined;
  let adSetId: string | undefined;
  let creativeId: string | undefined;
  let adId: string | undefined;

  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const body = await request.json();

    // --- Validate required fields ---
    const {
      account_id,
      name,
      objective,
      adset_name,
      ad_name,
      creative_url,
      destination_url,
    } = body;

    const missing: string[] = [];
    if (!account_id) missing.push("account_id");
    if (!name) missing.push("name");
    if (!objective) missing.push("objective");
    if (!adset_name) missing.push("adset_name");
    if (!ad_name) missing.push("ad_name");
    if (!creative_url) missing.push("creative_url");
    if (!destination_url) missing.push("destination_url");

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const _tok = await requireMetaTokenForRequest(workspaceId, account_id, accessToken);

    // --- Optional fields with defaults ---
    const status = body.status || "PAUSED";
    const optimization_goal = body.optimization_goal || "OFFSITE_CONVERSIONS";
    const daily_budget = body.daily_budget ? Number(body.daily_budget) : undefined;
    const headline = body.headline || "";
    const adBody = body.body || "";
    const cta = body.cta || "SHOP_NOW";
    const url_tags = body.url_tags || DEFAULT_URL_TAGS;

    // Step 3 image download happens outside the token scope (plain HTTP fetch)
    const imageRes = await fetchCreativeImage(creative_url);
    if (!imageRes.ok) {
      return NextResponse.json(
        {
          error: `Failed to download image from creative_url: ${imageRes.status} ${imageRes.statusText}`,
          step: "download_image",
        },
        { status: 400 }
      );
    }

    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "creative_url must return an image", step: "download_image" },
        { status: 400 }
      );
    }

    const contentLength = Number(imageRes.headers.get("content-length") || "0");
    if (contentLength > MAX_CREATIVE_BYTES) {
      return NextResponse.json(
        { error: "creative_url image is too large", step: "download_image" },
        { status: 400 }
      );
    }

    const imageBuffer = await imageRes.arrayBuffer();
    if (imageBuffer.byteLength > MAX_CREATIVE_BYTES) {
      return NextResponse.json(
        { error: "creative_url image is too large", step: "download_image" },
        { status: 400 }
      );
    }

    const ext = contentType.includes("png") ? "png" : "jpg";
    const imageFile = new File([imageBuffer], `creative.${ext}`, { type: contentType });

    const formData = new FormData();
    formData.set("filename", imageFile);
    formData.set("account_id", account_id);

    // All Meta API calls run inside runWithToken for race-safe token scoping
    const result = await runWithToken(_tok, async () => {
      // =========================================
      // Step 1: Create Campaign
      // =========================================
      const campaignResult = (await createCampaign({
        account_id,
        name,
        objective,
        status,
        special_ad_categories: [],
      })) as { id: string };

      campaignId = campaignResult.id;

      // =========================================
      // Step 2: Create Ad Set
      // =========================================
      const adSetArgs: Record<string, unknown> = {
        account_id,
        campaign_id: campaignId,
        name: adset_name,
        optimization_goal,
        billing_event: "IMPRESSIONS",
        status: "PAUSED",
      };

      if (daily_budget) {
        adSetArgs.daily_budget = Math.round(daily_budget * 100); // BRL → cents
      }

      const adSetResult = (await createAdSet(adSetArgs)) as { id: string };
      adSetId = adSetResult.id;

      // =========================================
      // Step 3: Upload image to Meta
      // =========================================
      const uploadResult = (await uploadAdImage(formData)) as {
        images: Record<string, { hash: string }>;
      };

      // Extract image hash from response (Meta returns { images: { [key]: { hash } } })
      const imageKey = Object.keys(uploadResult.images || {})[0];
      const imageHash = uploadResult.images?.[imageKey]?.hash;

      if (!imageHash) {
        throw new Error("Image uploaded but no hash returned from Meta");
      }

      // =========================================
      // Step 4: Create Creative
      // =========================================
      const creativeResult = (await createAdCreative({
        account_id,
        name: `${ad_name} - Creative`,
        title: headline,
        body: adBody,
        image_hash: imageHash,
        link: destination_url,
        call_to_action: cta,
      })) as { id: string };

      creativeId = creativeResult.id;

      // =========================================
      // Step 5: Create Ad
      // =========================================
      const adResult = (await createAd({
        account_id,
        adset_id: adSetId,
        name: ad_name,
        status: "PAUSED",
        creative: { creative_id: creativeId },
        url_tags,
      })) as { id: string };

      adId = adResult.id;

      return {
        campaign_id: campaignId,
        adset_id: adSetId,
        creative_id: creativeId,
        ad_id: adId,
      };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);

    const message = error instanceof Error ? error.message : String(error);

    // Determine which step failed
    let step = "unknown";
    if (!campaignId) step = "create_campaign";
    else if (!adSetId) step = "create_adset";
    else if (!creativeId) step = "create_creative";
    else if (!adId) step = "create_ad";

    console.error(`[Campaign Create] Failed at ${step}:`, message);

    return NextResponse.json(
      {
        error: `Failed at step '${step}': ${message}`,
        step,
        ...(campaignId && { campaign_id: campaignId }),
        ...(adSetId && { adset_id: adSetId }),
        ...(creativeId && { creative_id: creativeId }),
      },
      { status: 500 }
    );
  }
}
