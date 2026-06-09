/**
 * Clone every source campaign that does NOT yet exist in the destination account.
 *
 * Source:      act_880937624549391
 * Destination: act_1232344655348024  (pixel remapped -> 1369443261478323)
 *
 * "Already exists" is decided by NORMALIZED campaign name: we strip any known
 * clone prefix ([CLONE], [CLONE-TOP4], [CLONE-MISSING]) from both sides and
 * compare. So a destination campaign named "[CLONE] Foo" counts as already
 * having source campaign "Foo".
 *
 * A source campaign is only cloned if it is "100% cloneable":
 *   - every active ad has effective_object_story_id (re-referenceable page post)
 *   - no custom audiences (IDs don't exist in destination account)
 *   - no product catalog / product set in promoted_object
 *   - no dynamic creative
 *   - no VALUE optimization
 * Non-cloneable missing campaigns are listed with the reason, never half-created.
 *
 * Flags:
 *   --all       include campaigns of ANY status (default: ACTIVE only)
 *   --prefix=X  prepend "X " to cloned campaign names (default: keep original name)
 *   --confirm   actually create campaigns/adsets/ads (default: dry run)
 *
 * Usage:
 *   npx tsx scripts/clone-missing-campaigns.ts                 # dry run, active only
 *   npx tsx scripts/clone-missing-campaigns.ts --all           # dry run, all statuses
 *   npx tsx scripts/clone-missing-campaigns.ts --confirm       # clone the missing ones
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const SRC_ACCOUNT = "act_880937624549391";
const DST_ACCOUNT = "act_1232344655348024";
const DST_PIXEL = "1369443261478323";
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";

const INCLUDE_ALL_STATUSES = process.argv.includes("--all");
const CONFIRM = process.argv.includes("--confirm");
const PREFIX_ARG = process.argv.find((a) => a.startsWith("--prefix="));
const NAME_PREFIX = PREFIX_ARG ? PREFIX_ARG.split("=").slice(1).join("=").trim() : "";

// strip a leading clone tag like "[CLONE] " / "[CLONE-TOP4] " for diffing
const CLONE_TAG_RE = /^\s*\[CLONE[^\]]*\]\s*/i;
function normalizeName(name: string): string {
  return name.replace(CLONE_TAG_RE, "").trim().toLowerCase();
}

// ---------- tokens ----------

async function getSrcToken(): Promise<string> {
  // Direct override: lets us pass a fresh source-account token without touching
  // Supabase (the Bulking workspace's meta_connections row may be absent/expired).
  const envTok = (process.env.META_SRC_ACCESS_TOKEN || "").trim();
  if (envTok) return envTok;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", WORKSPACE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data)
    throw new Error(
      `No meta_connections for workspace and META_SRC_ACCESS_TOKEN not set: ${error?.message}`
    );
  return decrypt(data.access_token);
}

function getDstToken(): string {
  const t = (process.env.META_DST_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("META_DST_ACCESS_TOKEN not set in .env.local");
  return t;
}

// ---------- HTTP ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function graphGet(url: string, token: string): Promise<Record<string, unknown>> {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}access_token=${token}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) {
    const err = data.error as { message: string; code?: number };
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s");
      await sleep(60000);
      return graphGet(url, token);
    }
    throw new Error(`Graph GET: ${err.message}`);
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
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) {
    const err = data.error as { message: string; code?: number; error_user_msg?: string };
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ... Rate limited, waiting 60s");
      await sleep(60000);
      return graphPost(url, token, params);
    }
    throw new Error(`Graph POST (${err.code}): ${err.error_user_msg || err.message}`);
  }
  return data;
}

async function paged(url: string, token: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | undefined = url;
  while (next) {
    const data: any =
      next === url ? await graphGet(next, token) : await fetch(next).then((r) => r.json());
    if (data.error) break;
    out.push(...(data.data || []));
    next = data.paging?.next;
  }
  return out;
}

// ---------- types ----------

interface SrcCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  special_ad_categories: string[];
  buying_type: string;
}

interface Cloneability {
  ads_total: number;
  ads_with_story_id: number;
  cloneable: boolean;
  blockers: string[];
}

// ---------- discovery ----------

async function fetchCampaigns(account: string, token: string): Promise<SrcCampaign[]> {
  const fields =
    "id,name,objective,effective_status,status,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type";
  let url = `${BASE}/${account}/campaigns?fields=${fields}&limit=200`;
  if (!INCLUDE_ALL_STATUSES) {
    url += `&filtering=${encodeURIComponent(
      JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
    )}`;
  }
  const rows = await paged(url, token);
  return rows.map((c: any) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    effective_status: c.effective_status,
    daily_budget: c.daily_budget,
    lifetime_budget: c.lifetime_budget,
    bid_strategy: c.bid_strategy,
    special_ad_categories: c.special_ad_categories || [],
    buying_type: c.buying_type || "AUCTION",
  }));
}

async function assessCloneability(c: SrcCampaign, srcToken: string): Promise<Cloneability> {
  const blockers: string[] = [];

  const ads = await paged(
    `${BASE}/${c.id}/ads?fields=id,name,effective_status,creative{id,effective_object_story_id,product_set_id,template_url_spec,object_type,object_story_spec}&filtering=${encodeURIComponent(
      JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
    )}&limit=200`,
    srcToken
  );
  const adsArr = ads as any[];
  const adsTotal = adsArr.length;
  const adsWithStory = adsArr.filter((a) => a.creative?.effective_object_story_id).length;

  let hasDynamicCreative = false;
  for (const ad of adsArr) {
    const cr = ad.creative || {};
    if (cr.product_set_id) hasDynamicCreative = true;
    if (cr.template_url_spec) hasDynamicCreative = true;
    if (cr.object_type === "DYNAMIC") hasDynamicCreative = true;
    if (cr.object_story_spec?.template_data) hasDynamicCreative = true;
  }

  const adSets = await paged(
    `${BASE}/${c.id}/adsets?fields=id,targeting,promoted_object,optimization_goal&limit=100`,
    srcToken
  );
  let hasCustomAud = false;
  let hasCatalog = false;
  let hasValueOpt = false;
  for (const a of adSets as any[]) {
    const t = a.targeting || {};
    if (Array.isArray(t.custom_audiences) && t.custom_audiences.length > 0) hasCustomAud = true;
    if (Array.isArray(t.excluded_custom_audiences) && t.excluded_custom_audiences.length > 0)
      hasCustomAud = true;
    const po = a.promoted_object || {};
    if (po.product_catalog_id || po.product_set_id) hasCatalog = true;
    if (a.optimization_goal === "VALUE") hasValueOpt = true;
  }

  if (adsTotal === 0) blockers.push("no_active_ads");
  if (adsTotal > 0 && adsWithStory < adsTotal)
    blockers.push(`cloneability=${((adsWithStory / adsTotal) * 100).toFixed(0)}%`);
  if (hasCustomAud) blockers.push("custom_aud");
  if (hasCatalog) blockers.push("catalog_po");
  if (hasDynamicCreative) blockers.push("dyn_creative");
  if (hasValueOpt) blockers.push("value_opt");

  return {
    ads_total: adsTotal,
    ads_with_story_id: adsWithStory,
    cloneable: blockers.length === 0,
    blockers,
  };
}

// ---------- clone ----------

async function cloneCampaign(
  srcToken: string,
  dstToken: string,
  src: SrcCampaign
): Promise<{ ok: number; fail: number; campaign_id?: string }> {
  console.log(`\n--- Cloning: ${src.name}`);

  const cloneName = NAME_PREFIX ? `${NAME_PREFIX} ${src.name}` : src.name;

  const campaignParams: Record<string, unknown> = {
    name: cloneName,
    objective: src.objective,
    status: "PAUSED",
    special_ad_categories: src.special_ad_categories || [],
    buying_type: src.buying_type || "AUCTION",
  };
  if (src.daily_budget) campaignParams.daily_budget = src.daily_budget;
  if (src.lifetime_budget) campaignParams.lifetime_budget = src.lifetime_budget;
  if (!src.daily_budget && !src.lifetime_budget) {
    campaignParams.is_adset_budget_sharing_enabled = "false";
  }
  if (src.bid_strategy && (src.daily_budget || src.lifetime_budget)) {
    campaignParams.bid_strategy = src.bid_strategy;
  }

  let newCampaignId: string;
  try {
    const r = await graphPost(`${BASE}/${DST_ACCOUNT}/campaigns`, dstToken, campaignParams);
    newCampaignId = r.id as string;
    console.log(`  Campaign OK: ${newCampaignId}`);
  } catch (e) {
    console.log(`  Campaign FAIL: ${e}`);
    return { ok: 0, fail: 0 };
  }

  await sleep(1000);

  const adsetFields =
    "id,name,optimization_goal,targeting,targeting_automation,promoted_object,daily_budget,lifetime_budget,billing_event,destination_type,bid_strategy";
  const adSets = await paged(`${BASE}/${src.id}/adsets?fields=${adsetFields}&limit=100`, srcToken);
  console.log(`  ${adSets.length} ad set(s)`);

  const adSetIdMap = new Map<string, string>();
  for (const a of adSets as any[]) {
    const promoted = { ...(a.promoted_object || {}) };
    if (promoted.pixel_id) promoted.pixel_id = DST_PIXEL;

    const targeting = { ...(a.targeting || {}) };
    delete targeting.custom_audiences;
    delete targeting.excluded_custom_audiences;

    const params: Record<string, unknown> = {
      campaign_id: newCampaignId,
      name: a.name,
      optimization_goal: a.optimization_goal,
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      targeting,
      promoted_object: promoted,
      start_time: new Date(Date.now() + 86400000).toISOString(),
    };
    if (a.targeting_automation) params.targeting_automation = a.targeting_automation;
    if (a.daily_budget) params.daily_budget = a.daily_budget;
    if (a.lifetime_budget) params.lifetime_budget = a.lifetime_budget;
    if (a.bid_strategy) params.bid_strategy = a.bid_strategy;

    try {
      const r = await graphPost(`${BASE}/${DST_ACCOUNT}/adsets`, dstToken, params);
      adSetIdMap.set(a.id, r.id as string);
      console.log(`    AdSet OK: ${a.name} -> ${r.id}`);
    } catch (e) {
      console.log(`    AdSet FAIL: ${a.name} -> ${e}`);
    }
    await sleep(500);
  }

  const ads = await paged(
    `${BASE}/${src.id}/ads?fields=id,name,status,adset_id,creative{id,effective_object_story_id,url_tags}&filtering=${encodeURIComponent(
      JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
    )}&limit=200`,
    srcToken
  );
  console.log(`  ${ads.length} active ad(s)`);

  let ok = 0;
  let fail = 0;
  for (const ad of ads as any[]) {
    const newAdSetId = adSetIdMap.get(ad.adset_id);
    if (!newAdSetId) {
      console.log(`    Ad SKIP "${ad.name}" (parent adset missing)`);
      fail++;
      continue;
    }
    const storyId = ad.creative?.effective_object_story_id;
    if (!storyId) {
      console.log(`    Ad SKIP "${ad.name}" (no story id)`);
      fail++;
      continue;
    }

    let newCreativeId: string;
    try {
      const cParams: Record<string, unknown> = { name: ad.name, object_story_id: storyId };
      if (ad.creative?.url_tags) cParams.url_tags = ad.creative.url_tags;
      const cr = await graphPost(`${BASE}/${DST_ACCOUNT}/adcreatives`, dstToken, cParams);
      newCreativeId = cr.id as string;
    } catch (e) {
      console.log(`    Creative FAIL "${ad.name}" -> ${e}`);
      fail++;
      continue;
    }

    try {
      const r = await graphPost(`${BASE}/${DST_ACCOUNT}/ads`, dstToken, {
        name: ad.name,
        adset_id: newAdSetId,
        creative: { creative_id: newCreativeId },
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

// ---------- main ----------

async function main() {
  console.log("=== Clone MISSING campaigns (source -> destination) ===");
  console.log(`Source:      ${SRC_ACCOUNT}`);
  console.log(`Destination: ${DST_ACCOUNT}`);
  console.log(`Pixel remap: -> ${DST_PIXEL}`);
  console.log(`Status scope: ${INCLUDE_ALL_STATUSES ? "ALL statuses" : "ACTIVE only"}`);
  console.log(`Name prefix:  ${NAME_PREFIX ? `"${NAME_PREFIX} " + original` : "(keep original name)"}\n`);

  const srcToken = await getSrcToken();
  const dstToken = getDstToken();
  console.log(`SRC token loaded (len=${srcToken.length})`);
  console.log(`DST token loaded (len=${dstToken.length})\n`);

  const [srcCampaigns, dstCampaigns] = await Promise.all([
    fetchCampaigns(SRC_ACCOUNT, srcToken),
    fetchCampaigns(DST_ACCOUNT, dstToken),
  ]);
  console.log(`Source:      ${srcCampaigns.length} campaign(s)`);
  console.log(`Destination: ${dstCampaigns.length} campaign(s)`);

  const dstNorm = new Set(dstCampaigns.map((c) => normalizeName(c.name)));

  const missing = srcCampaigns.filter((c) => !dstNorm.has(normalizeName(c.name)));
  const present = srcCampaigns.filter((c) => dstNorm.has(normalizeName(c.name)));

  console.log(`\nAlready in destination (skip): ${present.length}`);
  for (const c of present) console.log(`  = ${c.name}`);

  console.log(`\nMissing in destination: ${missing.length}`);
  if (missing.length === 0) {
    console.log("Nothing to clone. Destination already mirrors source.");
    return;
  }

  console.log("\nAssessing cloneability of missing campaigns...");
  const assessed: Array<{ c: SrcCampaign; a: Cloneability }> = [];
  for (const c of missing) {
    const a = await assessCloneability(c, srcToken);
    assessed.push({ c, a });
    const tag = a.cloneable ? "[OK]" : `[BLOCKED:${a.blockers.join(",")}]`;
    console.log(
      `  ${tag.padEnd(28)} status=${c.effective_status.padEnd(10)} ads=${a.ads_with_story_id}/${a.ads_total}  ${c.name}`
    );
    await sleep(200);
  }

  const cloneable = assessed.filter((x) => x.a.cloneable).map((x) => x.c);
  const blocked = assessed.filter((x) => !x.a.cloneable);

  console.log(`\n--- Plan ---`);
  console.log(`Cloneable (will clone): ${cloneable.length}`);
  for (const c of cloneable) console.log(`  + ${c.name}`);
  console.log(`Blocked (manual / skipped): ${blocked.length}`);
  for (const x of blocked) console.log(`  ! ${x.c.name}  (${x.a.blockers.join(",")})`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — pass --confirm to actually clone the cloneable ones.");
    return;
  }

  if (cloneable.length === 0) {
    console.log("\nNo cloneable campaigns. Nothing to do.");
    return;
  }

  console.log(`\n=== Cloning ${cloneable.length} campaign(s) ===`);
  let totalOk = 0;
  let totalFail = 0;
  let campaignsOk = 0;
  let campaignsFail = 0;
  for (const c of cloneable) {
    try {
      const r = await cloneCampaign(srcToken, dstToken, c);
      totalOk += r.ok;
      totalFail += r.fail;
      if (r.campaign_id) campaignsOk++;
      else campaignsFail++;
    } catch (e) {
      console.log(`Campaign FATAL "${c.name}": ${e}`);
      campaignsFail++;
    }
    await sleep(2000);
  }
  console.log("\n" + "=".repeat(60));
  console.log(`Campaigns: ${campaignsOk} cloned, ${campaignsFail} failed`);
  console.log(`Ads: ${totalOk} created, ${totalFail} failed`);
  if (blocked.length > 0) {
    console.log(`Blocked (not cloned): ${blocked.length} — see list above`);
  }
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
