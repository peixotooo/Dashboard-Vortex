/**
 * Clone campaigns from 001BK (act_880937624549391) to BK COM (act_1232344655348024)
 *
 * Strategy: Use effective_object_story_id to reference existing page posts.
 * Since both accounts use the same BULKING page, this avoids re-uploading media.
 *
 * Usage: npx tsx scripts/clone-campaigns.ts
 */

import * as fs from "fs";
import * as path from "path";

// --- Config ---

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// Source
const SRC_ACCOUNT = "act_880937624549391";
const SRC_TOKEN = fs
  .readFileSync(path.resolve(__dirname, "../.env.local"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("META_ACCESS_TOKEN="))!
  .split("=")
  .slice(1)
  .join("=")
  .trim();

// Destination (App 1682230706522517)
const DST_ACCOUNT = "act_1232344655348024";
const DST_TOKEN = fs
  .readFileSync(path.resolve(__dirname, "../.env.local"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("META_DST_ACCESS_TOKEN="))!
  .split("=")
  .slice(1)
  .join("=")
  .trim();

// Pixel mapping
const DST_PIXEL = "1369443261478323";

// --- HTTP helpers ---

async function graphGet(
  url: string,
  token: string
): Promise<Record<string, unknown>> {
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}access_token=${token}`;

  const res = await fetch(fullUrl);
  const data = (await res.json()) as Record<string, unknown>;

  if (data.error) {
    const err = data.error as { message: string; code?: number };
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s...");
      await sleep(60000);
      return graphGet(url, token);
    }
    throw new Error(`Graph API: ${err.message}`);
  }

  return data;
}

async function graphPost(
  url: string,
  token: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams();
  body.append("access_token", token);

  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    body.append(key, typeof val === "string" ? val : JSON.stringify(val));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (data.error) {
    const err = data.error as {
      message: string;
      code?: number;
      error_subcode?: number;
      error_user_msg?: string;
    };
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s...");
      await sleep(60000);
      return graphPost(url, token, params);
    }
    const detail = err.error_user_msg || err.message;
    throw new Error(`Graph API (${err.code}): ${detail}`);
  }

  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Interfaces ---

interface Campaign {
  id: string;
  name: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  special_ad_categories: string[];
  buying_type: string;
}

interface AdSet {
  id: string;
  name: string;
  optimization_goal: string;
  targeting: Record<string, unknown>;
  targeting_automation?: Record<string, unknown>;
  promoted_object?: Record<string, unknown>;
  daily_budget?: string;
  lifetime_budget?: string;
  billing_event?: string;
  destination_type?: string;
  bid_strategy?: string;
}

interface Ad {
  id: string;
  name: string;
  status: string;
  adset_id: string;
  effective_object_story_id?: string;
  url_tags?: string;
  creative_id?: string;
}

// --- Data fetching ---

async function fetchCampaigns(): Promise<Campaign[]> {
  const data = await graphGet(
    `${BASE}/${SRC_ACCOUNT}/campaigns?fields=id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type&effective_status=["ACTIVE"]&limit=50`,
    SRC_TOKEN
  );
  return (data.data as Campaign[]) || [];
}

async function fetchAdSets(campaignId: string): Promise<AdSet[]> {
  const data = await graphGet(
    `${BASE}/${campaignId}/adsets?fields=id,name,optimization_goal,targeting,targeting_automation,promoted_object,daily_budget,lifetime_budget,billing_event,destination_type,bid_strategy&limit=50`,
    SRC_TOKEN
  );
  return (data.data as AdSet[]) || [];
}

async function fetchAds(campaignId: string): Promise<Ad[]> {
  // Fetch ads with creative's effective_object_story_id
  const data = await graphGet(
    `${BASE}/${campaignId}/ads?fields=id,name,status,adset_id,creative.fields(id,effective_object_story_id,url_tags)&limit=50`,
    SRC_TOKEN
  );

  const rawAds = (data.data as Record<string, unknown>[]) || [];

  return rawAds.map((a) => {
    const creative = a.creative as Record<string, unknown> | undefined;
    return {
      id: a.id as string,
      name: a.name as string,
      status: a.status as string,
      adset_id: a.adset_id as string,
      effective_object_story_id: creative?.effective_object_story_id as
        | string
        | undefined,
      url_tags: creative?.url_tags as string | undefined,
      creative_id: creative?.id as string | undefined,
    };
  });
}

async function fetchExistingCampaigns(): Promise<Set<string>> {
  const data = await graphGet(
    `${BASE}/${DST_ACCOUNT}/campaigns?fields=name&limit=100`,
    DST_TOKEN
  );
  const names = new Set<string>();
  for (const c of (data.data as { name: string }[]) || []) {
    names.add(c.name);
  }
  return names;
}

// --- Clone logic ---

async function cloneCampaign(
  src: Campaign,
  existingNames: Set<string>
): Promise<{ ads_created: number; ads_failed: number }> {
  console.log(`\n--- Campaign: ${src.name}`);

  const cloneName = `[CLONE] ${src.name}`;
  if (existingNames.has(cloneName)) {
    console.log(`  SKIP: already exists in destination`);
    return { ads_created: 0, ads_failed: 0 };
  }

  // 1. Create campaign
  const campaignParams: Record<string, unknown> = {
    name: `[CLONE] ${src.name}`,
    objective: src.objective,
    status: "PAUSED",
    special_ad_categories: src.special_ad_categories || [],
    buying_type: src.buying_type || "AUCTION",
  };

  if (src.daily_budget) campaignParams.daily_budget = src.daily_budget;
  if (src.lifetime_budget) campaignParams.lifetime_budget = src.lifetime_budget;
  if (src.bid_strategy) campaignParams.bid_strategy = src.bid_strategy;

  let newCampaignId: string;
  try {
    const result = await graphPost(
      `${BASE}/${DST_ACCOUNT}/campaigns`,
      DST_TOKEN,
      campaignParams
    );
    newCampaignId = result.id as string;
    console.log(`  Campaign OK: ${newCampaignId}`);
  } catch (err) {
    console.log(`  Campaign FAIL: ${err}`);
    return { ads_created: 0, ads_failed: 0 };
  }

  await sleep(1000);

  // 2. Clone ad sets
  const adSets = await fetchAdSets(src.id);
  console.log(`  ${adSets.length} ad set(s)`);

  const adSetIdMap = new Map<string, string>();

  for (const adSet of adSets) {
    // Map pixel in promoted_object
    const promotedObject = { ...(adSet.promoted_object || {}) };
    if (promotedObject.pixel_id) {
      promotedObject.pixel_id = DST_PIXEL;
    }

    const adSetParams: Record<string, unknown> = {
      campaign_id: newCampaignId,
      name: adSet.name,
      optimization_goal: adSet.optimization_goal,
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      targeting: adSet.targeting,
      promoted_object: promotedObject,
      start_time: new Date(Date.now() + 86400000).toISOString(),
    };

    if (adSet.targeting_automation) {
      adSetParams.targeting_automation = adSet.targeting_automation;
    }
    if (adSet.daily_budget) adSetParams.daily_budget = adSet.daily_budget;
    if (adSet.lifetime_budget)
      adSetParams.lifetime_budget = adSet.lifetime_budget;
    if (adSet.bid_strategy) adSetParams.bid_strategy = adSet.bid_strategy;

    try {
      const result = await graphPost(
        `${BASE}/${DST_ACCOUNT}/adsets`,
        DST_TOKEN,
        adSetParams
      );
      adSetIdMap.set(adSet.id, result.id as string);
      console.log(`  AdSet OK: ${adSet.name} -> ${result.id}`);
    } catch (err) {
      console.log(`  AdSet FAIL: ${adSet.name} -> ${err}`);
    }

    await sleep(500);
  }

  // 3. Clone ads using effective_object_story_id
  const ads = await fetchAds(src.id);
  console.log(`  ${ads.length} ad(s)`);

  let adsCreated = 0;
  let adsFailed = 0;

  for (const ad of ads) {
    const newAdSetId = adSetIdMap.get(ad.adset_id);
    if (!newAdSetId) {
      console.log(`  Ad SKIP: "${ad.name}" (parent ad set not cloned)`);
      adsFailed++;
      continue;
    }

    if (!ad.effective_object_story_id) {
      console.log(
        `  Ad SKIP: "${ad.name}" (no effective_object_story_id)`
      );
      adsFailed++;
      continue;
    }

    // Create creative from page post (object_story_id)
    const creativeParams: Record<string, unknown> = {
      name: ad.name,
      object_story_id: ad.effective_object_story_id,
    };
    if (ad.url_tags) {
      creativeParams.url_tags = ad.url_tags;
    }

    let newCreativeId: string;
    try {
      const result = await graphPost(
        `${BASE}/${DST_ACCOUNT}/adcreatives`,
        DST_TOKEN,
        creativeParams
      );
      newCreativeId = result.id as string;
    } catch (err) {
      console.log(`  Creative FAIL: "${ad.name}" -> ${err}`);
      adsFailed++;
      continue;
    }

    // Create ad
    try {
      const result = await graphPost(`${BASE}/${DST_ACCOUNT}/ads`, DST_TOKEN, {
        name: ad.name,
        adset_id: newAdSetId,
        creative: { creative_id: newCreativeId },
        status: "PAUSED",
      });
      console.log(`  Ad OK: "${ad.name}" -> ${result.id}`);
      adsCreated++;
    } catch (err) {
      console.log(`  Ad FAIL: "${ad.name}" -> ${err}`);
      adsFailed++;
    }

    await sleep(500);
  }

  return { ads_created: adsCreated, ads_failed: adsFailed };
}

// --- Main ---

async function main() {
  console.log("=== Clone: 001BK -> BK COM ===");
  console.log(`Source: ${SRC_ACCOUNT}`);
  console.log(`Destination: ${DST_ACCOUNT}`);
  console.log(`Pixel: -> ${DST_PIXEL}`);
  console.log(`Strategy: effective_object_story_id (same page)\n`);

  const existingNames = await fetchExistingCampaigns();
  console.log(`${existingNames.size} existing campaigns in destination`);

  const campaigns = await fetchCampaigns();
  console.log(`${campaigns.length} active campaigns to clone\n`);

  let totalAdsCreated = 0;
  let totalAdsFailed = 0;
  let campaignsCloned = 0;
  let campaignsSkipped = 0;
  let campaignsFailed = 0;

  for (const campaign of campaigns) {
    try {
      if (existingNames.has(`[CLONE] ${campaign.name}`)) {
        campaignsSkipped++;
        continue;
      }
      const result = await cloneCampaign(campaign, existingNames);
      totalAdsCreated += result.ads_created;
      totalAdsFailed += result.ads_failed;
      campaignsCloned++;
    } catch (err) {
      campaignsFailed++;
      console.log(`\nFATAL: "${campaign.name}": ${err}`);
    }
    await sleep(2000);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Campaigns: ${campaignsCloned} cloned, ${campaignsSkipped} skipped, ${campaignsFailed} failed`);
  console.log(`Ads: ${totalAdsCreated} created, ${totalAdsFailed} failed`);
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
