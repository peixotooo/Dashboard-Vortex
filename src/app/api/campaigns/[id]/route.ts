import { NextRequest, NextResponse } from "next/server";
import {
  getCampaign,
  updateCampaign,
  listAdSets,
  listAds,
  getCreativeDetails,
  updateAdSet,
  updateAd,
  createAdCreative,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { id } = await params;

    // 1. Fetch campaign details
    const campaign = (await getCampaign({ campaign_id: id })) as Record<string, unknown>;

    // 2. Fetch ad sets for this campaign
    const adSetsResult = (await listAdSets({ campaign_id: id })) as {
      ad_sets: Array<Record<string, unknown>>;
    };
    const adset = adSetsResult.ad_sets?.[0] || null;

    if (!adset) {
      return NextResponse.json({
        campaign,
        adset: null,
        ad: null,
        creative: null,
      });
    }

    // 3. Fetch ads for the first ad set
    const adsResult = (await listAds({ adset_id: String(adset.id) })) as {
      ads: Array<Record<string, unknown>>;
    };
    const ad = adsResult.ads?.[0] || null;

    if (!ad) {
      return NextResponse.json({
        campaign,
        adset,
        ad: null,
        creative: null,
      });
    }

    // 4. Fetch creative details
    let creative = null;
    const creativeRef = ad.creative as { id?: string } | undefined;
    if (creativeRef?.id) {
      try {
        creative = await getCreativeDetails({
          creative_id: creativeRef.id,
          account_id: String(campaign.account_id || ""),
        });
      } catch {
        // Creative may have been deleted
      }
    }

    return NextResponse.json({ campaign, adset, ad, creative });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { id } = await params;
    const body = await request.json();
    const {
      campaign: campaignUpdate,
      adset: adsetUpdate,
      ad: adUpdate,
      creative: creativeUpdate,
      account_id,
    } = body;

    // 1. Update campaign (name, status, daily_budget)
    if (campaignUpdate) {
      await updateCampaign({
        campaign_id: id,
        ...(campaignUpdate.name && { name: campaignUpdate.name }),
        ...(campaignUpdate.status && { status: campaignUpdate.status }),
        ...(campaignUpdate.daily_budget && { daily_budget: campaignUpdate.daily_budget }),
      });
    }

    // 2. Update ad set (name, optimization_goal)
    if (adsetUpdate?.adset_id) {
      await updateAdSet({
        adset_id: adsetUpdate.adset_id,
        ...(adsetUpdate.name && { name: adsetUpdate.name }),
        ...(adsetUpdate.optimization_goal && { optimization_goal: adsetUpdate.optimization_goal }),
      });
    }

    // 3. Handle creative changes
    let newCreativeId: string | null = null;
    if (creativeUpdate?.changed) {
      // Create a new creative (Meta creatives are immutable)
      const creativeResult = (await createAdCreative({
        account_id,
        name: creativeUpdate.name || "Creative",
        title: creativeUpdate.title || "",
        body: creativeUpdate.body || "",
        image_hash: creativeUpdate.image_hash || "",
        link: creativeUpdate.link || "",
        call_to_action: creativeUpdate.call_to_action || "LEARN_MORE",
        ...(creativeUpdate.instagram_actor_id && {
          instagram_actor_id: creativeUpdate.instagram_actor_id,
        }),
      })) as { id: string };

      newCreativeId = creativeResult.id;
    }

    // 4. Update ad (name, url_tags, and/or new creative reference)
    if (adUpdate?.ad_id) {
      const adParams: Record<string, unknown> = { ad_id: adUpdate.ad_id };
      if (adUpdate.name) adParams.name = adUpdate.name;
      if (adUpdate.url_tags !== undefined) adParams.url_tags = adUpdate.url_tags;
      if (newCreativeId) {
        adParams.creative = { creative_id: newCreativeId };
      }

      await updateAd(adParams);
    }

    return NextResponse.json({
      success: true,
      campaign_id: id,
      ...(newCreativeId && { new_creative_id: newCreativeId }),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
