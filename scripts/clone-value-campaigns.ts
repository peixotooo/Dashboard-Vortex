/**
 * Clone the two strong "max_valor" (VALUE-optimized) source campaigns into the
 * destination account, downgrading optimization from VALUE -> OFFSITE_CONVERSIONS
 * (max conversions). VALUE optimization needs purchase-value history on the
 * destination pixel; downgrading to conversions lets them run immediately.
 *
 * Transforms vs a plain clone:
 *   - adset.optimization_goal VALUE -> OFFSITE_CONVERSIONS
 *   - drop ROAS-based bid_strategy (LOWEST_COST_WITH_MIN_ROAS) at campaign + adset
 *     (it requires value optimization) -> defaults to LOWEST_COST_WITHOUT_CAP
 *   - remap pixel, strip custom audiences (defense in depth; these have none)
 *
 * Source: act_880937624549391  ->  Destination: act_1232344655348024
 *
 * Token: META_SRC_ACCESS_TOKEN (read source) + META_DST_ACCESS_TOKEN (write dst).
 *
 * Usage:
 *   export META_SRC_ACCESS_TOKEN=...
 *   npx tsx scripts/clone-value-campaigns.ts            # dry run
 *   npx tsx scripts/clone-value-campaigns.ts --confirm  # clone
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const SRC_ACCOUNT = "act_880937624549391";
const DST_ACCOUNT = "act_1232344655348024";
const DST_PIXEL = "1369443261478323";
const NAME_PREFIX = "[CLONE 08/06]";
const CONFIRM = process.argv.includes("--confirm");

const ROAS_BID = "LOWEST_COST_WITH_MIN_ROAS";

// The two VALUE-only good performers (source campaign IDs).
const TARGETS = [
  { id: "120246301700730468", name: "0073-conv_vb-conversao_max_valor-hustle" },
  { id: "120244093581000468", name: "0054-conv_vb-conversao_max_valor-colecao_army" },
];

function getSrcToken(): string {
  const t = (process.env.META_SRC_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("META_SRC_ACCESS_TOKEN not set");
  return t;
}
function getDstToken(): string {
  const t = (process.env.META_DST_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("META_DST_ACCESS_TOKEN not set");
  return t;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function graphGet(url: string, token: string): Promise<any> {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}access_token=${token}`);
  const data: any = await res.json();
  if (data.error) {
    const err = data.error;
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s");
      await sleep(60000);
      return graphGet(url, token);
    }
    throw new Error(`Graph GET (${err.code}): ${err.message}`);
  }
  return data;
}

async function graphPost(url: string, token: string, params: Record<string, unknown>): Promise<any> {
  const body = new URLSearchParams();
  body.append("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data: any = await res.json();
  if (data.error) {
    const err = data.error;
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s");
      await sleep(60000);
      return graphPost(url, token, params);
    }
    throw new Error(`Graph POST (${err.code}): ${err.error_user_msg || err.message}`);
  }
  return data;
}

async function paged(url: string, token: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | undefined = url;
  while (next) {
    const data: any = next === url ? await graphGet(next, token) : await fetch(next).then((r) => r.json());
    if (data.error) break;
    out.push(...(data.data || []));
    next = data.paging?.next;
  }
  return out;
}

async function cloneOne(srcToken: string, dstToken: string, target: { id: string; name: string }) {
  console.log(`\n--- Cloning (VALUE->CONVERSIONS): ${target.name}`);

  const cFields =
    "id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type";
  const c: any = await graphGet(`${BASE}/${target.id}?fields=${cFields}`, srcToken);

  const campaignParams: Record<string, unknown> = {
    name: `${NAME_PREFIX} ${c.name}`,
    objective: c.objective,
    status: "PAUSED",
    special_ad_categories: c.special_ad_categories || [],
    buying_type: c.buying_type || "AUCTION",
  };
  if (c.daily_budget) campaignParams.daily_budget = c.daily_budget;
  if (c.lifetime_budget) campaignParams.lifetime_budget = c.lifetime_budget;
  if (!c.daily_budget && !c.lifetime_budget) campaignParams.is_adset_budget_sharing_enabled = "false";
  // keep campaign bid_strategy only if CBO AND not ROAS-based
  if (c.bid_strategy && c.bid_strategy !== ROAS_BID && (c.daily_budget || c.lifetime_budget)) {
    campaignParams.bid_strategy = c.bid_strategy;
  }

  if (!CONFIRM) {
    console.log(`  [dry] would create campaign: ${campaignParams.name} (obj=${c.objective})`);
  }

  let newCampaignId = "(dry)";
  if (CONFIRM) {
    const r = await graphPost(`${BASE}/${DST_ACCOUNT}/campaigns`, dstToken, campaignParams);
    newCampaignId = r.id as string;
    console.log(`  Campaign OK: ${newCampaignId}`);
    await sleep(1000);
  }

  const adsetFields =
    "id,name,optimization_goal,targeting,targeting_automation,promoted_object,daily_budget,lifetime_budget,billing_event,destination_type,bid_strategy";
  const adSets = await paged(`${BASE}/${target.id}/adsets?fields=${adsetFields}&limit=100`, srcToken);
  console.log(`  ${adSets.length} ad set(s)`);

  const adSetIdMap = new Map<string, string>();
  for (const a of adSets as any[]) {
    const promoted = { ...(a.promoted_object || {}) };
    if (promoted.pixel_id) promoted.pixel_id = DST_PIXEL;

    const targeting = { ...(a.targeting || {}) };
    delete targeting.custom_audiences;
    delete targeting.excluded_custom_audiences;

    const goal = a.optimization_goal === "VALUE" ? "OFFSITE_CONVERSIONS" : a.optimization_goal;

    const params: Record<string, unknown> = {
      campaign_id: newCampaignId,
      name: a.name,
      optimization_goal: goal,
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      targeting,
      promoted_object: promoted,
      start_time: new Date(Date.now() + 86400000).toISOString(),
    };
    if (a.targeting_automation) params.targeting_automation = a.targeting_automation;
    if (a.daily_budget) params.daily_budget = a.daily_budget;
    if (a.lifetime_budget) params.lifetime_budget = a.lifetime_budget;
    // drop ROAS-based bid strategy (needs value optimization)
    if (a.bid_strategy && a.bid_strategy !== ROAS_BID) params.bid_strategy = a.bid_strategy;

    const note = a.optimization_goal === "VALUE" ? "  [VALUE->OFFSITE_CONVERSIONS]" : "";
    if (!CONFIRM) {
      console.log(`    [dry] would create adset: ${a.name} goal=${goal}${note}`);
      continue;
    }
    try {
      const r = await graphPost(`${BASE}/${DST_ACCOUNT}/adsets`, dstToken, params);
      adSetIdMap.set(a.id, r.id as string);
      console.log(`    AdSet OK: ${a.name} -> ${r.id}${note}`);
    } catch (e) {
      console.log(`    AdSet FAIL: ${a.name} -> ${e}`);
    }
    await sleep(500);
  }

  const ads = await paged(
    `${BASE}/${target.id}/ads?fields=id,name,status,adset_id,creative{id,effective_object_story_id,url_tags}&filtering=${encodeURIComponent(
      JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
    )}&limit=200`,
    srcToken
  );
  console.log(`  ${ads.length} active ad(s)`);

  let ok = 0;
  let fail = 0;
  for (const ad of ads as any[]) {
    const storyId = ad.creative?.effective_object_story_id;
    if (!storyId) {
      console.log(`    Ad SKIP "${ad.name}" (no story id)`);
      fail++;
      continue;
    }
    if (!CONFIRM) {
      console.log(`    [dry] would create ad: ${ad.name}`);
      ok++;
      continue;
    }
    const newAdSetId = adSetIdMap.get(ad.adset_id);
    if (!newAdSetId) {
      console.log(`    Ad SKIP "${ad.name}" (parent adset missing)`);
      fail++;
      continue;
    }
    try {
      const cParams: Record<string, unknown> = { name: ad.name, object_story_id: storyId };
      if (ad.creative?.url_tags) cParams.url_tags = ad.creative.url_tags;
      const cr = await graphPost(`${BASE}/${DST_ACCOUNT}/adcreatives`, dstToken, cParams);
      const r = await graphPost(`${BASE}/${DST_ACCOUNT}/ads`, dstToken, {
        name: ad.name,
        adset_id: newAdSetId,
        creative: { creative_id: cr.id },
        status: "PAUSED",
      });
      console.log(`    Ad OK "${ad.name}" -> ${r.id}`);
      ok++;
    } catch (e) {
      console.log(`    Ad FAIL "${ad.name}" -> ${e}`);
      fail++;
    }
    await sleep(500);
  }
  return { ok, fail, campaign_id: newCampaignId };
}

async function main() {
  console.log("=== Clone VALUE campaigns (downgrade to conversions) ===");
  console.log(`Source: ${SRC_ACCOUNT} -> Destination: ${DST_ACCOUNT}`);
  console.log(`Pixel remap -> ${DST_PIXEL} | prefix "${NAME_PREFIX}"`);
  console.log(CONFIRM ? "MODE: CONFIRM\n" : "MODE: DRY RUN\n");

  const srcToken = getSrcToken();
  const dstToken = getDstToken();

  const results: Array<{ name: string; campaign_id: string; ok: number; fail: number }> = [];
  for (const t of TARGETS) {
    try {
      const r = await cloneOne(srcToken, dstToken, t);
      results.push({ name: t.name, ...r });
    } catch (e) {
      console.log(`FATAL "${t.name}": ${e}`);
    }
    await sleep(1500);
  }

  console.log("\n" + "=".repeat(60));
  for (const r of results) {
    console.log(`${r.name} -> ${r.campaign_id} (ads ${r.ok} ok / ${r.fail} fail)`);
  }
  console.log("=".repeat(60));
  if (!CONFIRM) console.log("DRY RUN — pass --confirm to actually clone.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
