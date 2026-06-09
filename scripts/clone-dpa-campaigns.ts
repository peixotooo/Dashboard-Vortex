/**
 * Recreate the source DPA / Advantage+ catalog campaigns in the destination
 * account, pointing at the NEW destination catalog + product sets.
 *
 * Source: act_880937624549391  ->  Destination: act_1232344655348024
 * New catalog: 1036446039042143 (BK COM - Catalogo) | Pixel: PixelBK 1369443261478323
 *
 * Per source DPA ad the creative is an Advantage+ catalog ad:
 *   object_story_spec.template_data (dynamic) + product_set_id + asset_feed_spec.
 * We reuse the creative spec verbatim, swapping product_set_id (source set ->
 * new set) and remapping the adset pixel. VALUE optimization is downgraded to
 * OFFSITE_CONVERSIONS (destination pixel has no value history yet), custom
 * audiences are stripped, ROAS bid strategy dropped.
 *
 * Tokens: META_SRC_ACCESS_TOKEN (read source) + META_CAT_TOKEN (write dst; the
 * combined token with ads_management + catalog + page access).
 *
 * Flags:
 *   --only=<srcCampaignId>   only this campaign
 *   --confirm                actually create (default: dry run)
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const DST_ACCOUNT = "act_1232344655348024";
const DST_PIXEL = "1369443261478323";
const NAME_PREFIX = "[CLONE 08/06]";
const ROAS_BID = "LOWEST_COST_WITH_MIN_ROAS";

// source product_set_id -> new (destination catalog) product_set_id
const SET_MAP: Record<string, string> = {
  "933101178148610": "2031290324144914", // "Todos os produtos"
  "664858979870686": "1039814778616676", // "SE - Camisetas por R$ 99" (37 via retailer_id)
};

// the DPA campaigns to recreate (source campaign ids)
const CAMPAIGNS: { label: string; id: string }[] = [
  { label: "0015", id: "120241637695240468" },
  { label: "0011", id: "120241637695290468" },
  { label: "0010", id: "120241637695320468" },
  { label: "0033", id: "120242679045000468" },
  { label: "0043", id: "120242956413100468" },
  // 0009 (120241637695300468) já criada
  { label: "0037", id: "120242679108390468" },
  { label: "0044", id: "120243088056620468" }, // uses set 664858979870686 (map when ready)
];

const CONFIRM = process.argv.includes("--confirm");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

// Read source with SRC; write the destination ad account with DST (the Bulking
// app token — its app HAS the create-adcreative capability; the combined CAT
// token's app does NOT, returns error #3). Catalog/sets were already created
// with the CAT token, so no catalog writes happen here.
const SRC = (process.env.META_SRC_ACCESS_TOKEN || "").trim();
const DST = (process.env.META_DST_ACCESS_TOKEN || "").trim();
if (!SRC || !DST) throw new Error("Need META_SRC_ACCESS_TOKEN and META_DST_ACCESS_TOKEN");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function g(url: string, tok: string): Promise<any> {
  const r = await fetch(`${BASE}/${url}${url.includes("?") ? "&" : "?"}access_token=${tok}`);
  const d = await r.json();
  if (d.error) {
    if ([4, 17, 32].includes(d.error.code)) {
      console.log("  ...rate limited 60s");
      await sleep(60000);
      return g(url, tok);
    }
    throw new Error(`GET ${url}: ${d.error.code} ${d.error.message}`);
  }
  return d;
}
async function post(path: string, tok: string, params: Record<string, unknown>): Promise<any> {
  const b = new URLSearchParams();
  b.append("access_token", tok);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    b.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const r = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: b.toString(),
  });
  const d = await r.json();
  if (d.error) {
    if ([4, 17, 32].includes(d.error.code)) {
      console.log("  ...rate limited 60s");
      await sleep(60000);
      return post(path, tok, params);
    }
    throw new Error(`POST ${path}: ${d.error.code} ${d.error.error_user_msg || d.error.message}`);
  }
  return d;
}
async function paged(url: string, tok: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | undefined = url;
  while (next) {
    const d: any = next === url ? await g(next, tok) : await fetch(next).then((r) => r.json());
    if (d.error) break;
    out.push(...(d.data || []));
    next = d.paging?.next;
  }
  return out;
}

async function cloneDpa(c: { label: string; id: string }) {
  console.log(`\n=== ${c.label} (${c.id}) ===`);
  const cf = "name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type";
  const cam = await g(`${c.id}?fields=${cf}`, SRC);

  const campaignParams: Record<string, unknown> = {
    name: `${NAME_PREFIX} ${cam.name}`,
    objective: cam.objective,
    status: "PAUSED",
    special_ad_categories: cam.special_ad_categories || [],
    buying_type: cam.buying_type || "AUCTION",
  };
  if (cam.daily_budget) campaignParams.daily_budget = cam.daily_budget;
  if (cam.lifetime_budget) campaignParams.lifetime_budget = cam.lifetime_budget;
  if (!cam.daily_budget && !cam.lifetime_budget) campaignParams.is_adset_budget_sharing_enabled = "false";
  if (cam.bid_strategy && cam.bid_strategy !== ROAS_BID && (cam.daily_budget || cam.lifetime_budget))
    campaignParams.bid_strategy = cam.bid_strategy;

  console.log(`  campaign: ${campaignParams.name} (obj=${cam.objective})`);
  let newCampaignId = "(dry)";
  if (CONFIRM) {
    const r = await post(`${DST_ACCOUNT}/campaigns`, DST, campaignParams);
    newCampaignId = r.id;
    console.log(`  campaign OK -> ${newCampaignId}`);
    await sleep(800);
  }

  const asFields =
    "id,name,optimization_goal,billing_event,bid_strategy,promoted_object,targeting,targeting_automation,daily_budget,lifetime_budget,destination_type";
  const adsets = await paged(`${c.id}/adsets?fields=${asFields}&limit=50`, SRC);
  const asMap = new Map<string, string>();
  for (const a of adsets) {
    const targeting = { ...(a.targeting || {}) };
    delete targeting.custom_audiences;
    delete targeting.excluded_custom_audiences;
    const promoted: Record<string, unknown> = {
      pixel_id: DST_PIXEL,
      custom_event_type: a.promoted_object?.custom_event_type || "PURCHASE",
    };
    const goal = a.optimization_goal === "VALUE" ? "OFFSITE_CONVERSIONS" : a.optimization_goal;
    const params: Record<string, unknown> = {
      campaign_id: newCampaignId,
      name: a.name,
      optimization_goal: goal,
      billing_event: a.billing_event || "IMPRESSIONS",
      status: "PAUSED",
      targeting,
      promoted_object: promoted,
      start_time: new Date(Date.now() + 86400000).toISOString(),
    };
    if (a.targeting_automation) params.targeting_automation = a.targeting_automation;
    if (a.destination_type) params.destination_type = a.destination_type;
    if (a.daily_budget) params.daily_budget = a.daily_budget;
    if (a.lifetime_budget) params.lifetime_budget = a.lifetime_budget;
    if (a.bid_strategy && a.bid_strategy !== ROAS_BID) params.bid_strategy = a.bid_strategy;

    const note = a.optimization_goal === "VALUE" ? " [VALUE->CONV]" : "";
    console.log(`  adset: ${a.name} goal=${goal}${note}`);
    if (CONFIRM) {
      const r = await post(`${DST_ACCOUNT}/adsets`, DST, params);
      asMap.set(a.id, r.id);
      console.log(`    adset OK -> ${r.id}`);
      await sleep(500);
    }
  }

  const ads = await paged(
    `${c.id}/ads?fields=name,adset_id,creative{name,object_story_spec,asset_feed_spec,degrees_of_freedom_spec,product_set_id,call_to_action_type}&filtering=${encodeURIComponent(
      JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
    )}&limit=20`,
    SRC
  );
  let ok = 0,
    fail = 0;
  for (const ad of ads) {
    const cr = ad.creative || {};
    const srcSet = cr.product_set_id;
    const newSet = SET_MAP[srcSet];
    if (!newSet) {
      console.log(`  ad SKIP "${ad.name}" — set ${srcSet} não mapeado`);
      fail++;
      continue;
    }
    // Minimal dynamic catalog creative (template_data + product_set). The
    // source's advanced Advantage+ features (asset_feed_spec FORMAT_AUTOMATION,
    // COLLECTION format, degrees_of_freedom_spec) trigger error #3 — the app
    // lacks that capability. Dropped; re-enable in Ads Manager UI if wanted.
    // NOTE: do NOT send top-level call_to_action_type — it triggers error #3
    // (app capability). The CTA already lives inside template_data.call_to_action.
    const creativeParams: Record<string, unknown> = {
      name: cr.name || ad.name,
      object_story_spec: cr.object_story_spec,
      product_set_id: newSet,
    };

    console.log(`  ad: "${ad.name}" set ${srcSet} -> ${newSet}`);
    if (!CONFIRM) {
      ok++;
      continue;
    }
    const newAdSetId = asMap.get(ad.adset_id);
    if (!newAdSetId) {
      console.log(`    ad FAIL (adset pai ausente)`);
      fail++;
      continue;
    }
    try {
      const crres = await post(`${DST_ACCOUNT}/adcreatives`, DST, creativeParams);
      const adres = await post(`${DST_ACCOUNT}/ads`, DST, {
        name: ad.name,
        adset_id: newAdSetId,
        creative: { creative_id: crres.id },
        status: "PAUSED",
      });
      console.log(`    ad OK -> ${adres.id}`);
      ok++;
    } catch (e) {
      console.log(`    ad FAIL -> ${e}`);
      fail++;
    }
    await sleep(500);
  }
  return { campaign_id: newCampaignId, ok, fail };
}

async function main() {
  console.log("=== Clone DPA / catalog campaigns ===");
  console.log(CONFIRM ? "MODE: CONFIRM" : "MODE: DRY RUN");
  const list = ONLY ? CAMPAIGNS.filter((c) => c.id === ONLY) : CAMPAIGNS;
  const results: any[] = [];
  for (const c of list) {
    try {
      results.push({ label: c.label, ...(await cloneDpa(c)) });
    } catch (e) {
      console.log(`FATAL ${c.label}: ${e}`);
      results.push({ label: c.label, campaign_id: "FAIL", ok: 0, fail: 0 });
    }
    await sleep(1500);
  }
  console.log("\n" + "=".repeat(60));
  for (const r of results) console.log(`${r.label} -> ${r.campaign_id} (ads ${r.ok}/${r.ok + r.fail})`);
  console.log("=".repeat(60));
  if (!CONFIRM) console.log("DRY RUN — pass --confirm to create.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
