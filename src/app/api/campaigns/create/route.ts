import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import {
  createCampaign,
  createAdSet,
  uploadAdImage,
  createAdCreative,
  createAd,
} from "@/lib/meta-api";

export const maxDuration = 60;

const DEFAULT_URL_TAGS =
  "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}";

export async function POST(request: NextRequest) {
  // Track created IDs for error context
  let campaignId: string | undefined;
  let adSetId: string | undefined;
  let creativeId: string | undefined;
  let adId: string | undefined;

  try {
    // Auth — same pattern as POST /api/campaigns (fallback to env token)
    await getAuthenticatedContext(request).catch(() => {});

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

    // --- Optional fields with defaults ---
    const status = body.status || "PAUSED";
    const optimization_goal = body.optimization_goal || "OFFSITE_CONVERSIONS";
    const daily_budget = body.daily_budget ? Number(body.daily_budget) : undefined;
    const headline = body.headline || "";
    const adBody = body.body || "";
    const cta = body.cta || "SHOP_NOW";
    const url_tags = body.url_tags || DEFAULT_URL_TAGS;

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
    // Step 3: Download image & upload to Meta
    // =========================================
    const imageRes = await fetch(creative_url);
    if (!imageRes.ok) {
      return NextResponse.json(
        {
          error: `Failed to download image from creative_url: ${imageRes.status} ${imageRes.statusText}`,
          step: "download_image",
          campaign_id: campaignId,
          adset_id: adSetId,
        },
        { status: 400 }
      );
    }

    const imageBlob = await imageRes.blob();
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const imageFile = new File([imageBlob], `creative.${ext}`, { type: contentType });

    const formData = new FormData();
    formData.set("filename", imageFile);
    formData.set("account_id", account_id);

    const uploadResult = (await uploadAdImage(formData)) as {
      images: Record<string, { hash: string }>;
    };

    // Extract image hash from response (Meta returns { images: { [key]: { hash } } })
    const imageKey = Object.keys(uploadResult.images || {})[0];
    const imageHash = uploadResult.images?.[imageKey]?.hash;

    if (!imageHash) {
      return NextResponse.json(
        {
          error: "Image uploaded but no hash returned from Meta",
          step: "upload_image",
          campaign_id: campaignId,
          adset_id: adSetId,
        },
        { status: 500 }
      );
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

    return NextResponse.json({
      success: true,
      campaign_id: campaignId,
      adset_id: adSetId,
      creative_id: creativeId,
      ad_id: adId,
    });
  } catch (error) {
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
