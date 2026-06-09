/**
 * Rank source-account campaigns by performance, to decide which to activate
 * in the destination account.
 *
 * Source: act_880937624549391
 *
 * Performance comes from ACCOUNT-LEVEL insights (one call per window — cheap,
 * does NOT re-trigger the per-campaign rate limiting). Two windows are pulled:
 * last_30d and last_90d.
 *
 * Token: reads META_SRC_ACCESS_TOKEN from env (same as clone-missing-campaigns.ts).
 *   export META_SRC_ACCESS_TOKEN=...
 *   npx tsx scripts/analyze-source-performance.ts
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const SRC_ACCOUNT = "act_880937624549391";

function getSrcToken(): string {
  const t = (process.env.META_SRC_ACCESS_TOKEN || "").trim();
  if (!t) throw new Error("META_SRC_ACCESS_TOKEN not set");
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

const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

function pickValue(arr: Array<{ action_type: string; value: string }> | undefined): number {
  if (!Array.isArray(arr)) return 0;
  for (const t of PURCHASE_TYPES) {
    const m = arr.find((a) => a.action_type === t);
    if (m) return parseFloat(m.value || "0");
  }
  return 0;
}

interface Perf {
  spend: number;
  revenue: number;
  purchases: number;
  roas: number;
  cpa: number;
}

function emptyPerf(): Perf {
  return { spend: 0, revenue: 0, purchases: 0, roas: 0, cpa: 0 };
}

async function fetchInsights(token: string, datePreset: string): Promise<Map<string, Perf>> {
  const fields = "campaign_id,campaign_name,spend,actions,action_values";
  const rows = await paged(
    `${BASE}/${SRC_ACCOUNT}/insights?fields=${fields}&level=campaign&date_preset=${datePreset}&limit=500`,
    token
  );
  const map = new Map<string, Perf>();
  for (const r of rows as any[]) {
    const spend = parseFloat(r.spend || "0");
    const revenue = pickValue(r.action_values);
    const purchases = pickValue(r.actions);
    map.set(String(r.campaign_id), {
      spend,
      revenue,
      purchases,
      roas: spend > 0 ? revenue / spend : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
    });
  }
  return map;
}

// Cloneability verdict for cross-account 1:1 cloning (custom audiences / catalog
// / dynamic creative / value optimization block a clean clone).
const CLONE_TAG_RE = /^\s*\[CLONE[^\]]*\]\s*/i;

async function main() {
  const token = getSrcToken();
  console.log("=== Source campaign performance ranking ===");
  console.log(`Account: ${SRC_ACCOUNT}\n`);

  const campaigns = await paged(
    `${BASE}/${SRC_ACCOUNT}/campaigns?fields=id,name,objective,effective_status,status&limit=300`,
    token
  );
  console.log(`Campaigns: ${campaigns.length}`);

  console.log("Fetching insights (last_30d)...");
  const p30 = await fetchInsights(token, "last_30d");
  console.log("Fetching insights (last_90d)...");
  const p90 = await fetchInsights(token, "last_90d");

  const rows = (campaigns as any[]).map((c) => {
    const a = p30.get(c.id) || emptyPerf();
    const b = p90.get(c.id) || emptyPerf();
    return { c, a, b };
  });

  // Rank by 90d spend (volume) — ROAS shown alongside for quality.
  rows.sort((x, y) => y.b.spend - x.b.spend);

  const fmt = (n: number, w = 7) => n.toFixed(0).padStart(w);
  console.log("\n" + "=".repeat(110));
  console.log(
    `${"status".padEnd(11)} | ${"30d spend".padStart(9)} ${"roas".padStart(5)} ${"buys".padStart(4)} | ${"90d spend".padStart(9)} ${"roas".padStart(5)} ${"buys".padStart(5)} | name`
  );
  console.log("=".repeat(110));
  for (const { c, a, b } of rows) {
    console.log(
      `${String(c.effective_status).padEnd(11)} | ${fmt(a.spend, 9)} ${a.roas.toFixed(2).padStart(5)} ${fmt(a.purchases, 4)} | ${fmt(b.spend, 9)} ${b.roas.toFixed(2).padStart(5)} ${fmt(b.purchases, 5)} | ${c.name}`
    );
  }
  console.log("=".repeat(110));

  // JSON dump for downstream consumption
  console.log("\n--- JSON ---");
  console.log(
    JSON.stringify(
      rows.map(({ c, a, b }) => ({
        id: c.id,
        name: c.name,
        normalized: c.name.replace(CLONE_TAG_RE, "").trim(),
        objective: c.objective,
        status: c.effective_status,
        d30: a,
        d90: b,
      })),
      null,
      0
    )
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
