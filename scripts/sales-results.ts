/** READ-ONLY: resultados de vendas — por canal (GA4) + status das campanhas TikTok. */
import { config } from "dotenv";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";

function ga4() {
  const raw = process.env.GA4_CREDENTIALS_JSON!.trim();
  let c: any; try { c = JSON.parse(raw); } catch { c = JSON.parse(raw.replace(/\n/g, "\\n")); }
  if (c.private_key) c.private_key = c.private_key.replace(/\\n/g, "\n");
  return new BetaAnalyticsDataClient({ credentials: c });
}
const brl = (n: number) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // ontem (dia completo)
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // ===== GA4: vendas por canal =====
  const c = ga4();
  const property = `properties/${process.env.GA4_PROPERTY_ID}`;
  const [rep] = await c.runReport({
    property, dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }, { name: "purchaseRevenue" }],
    orderBys: [{ metric: { metricName: "purchaseRevenue" }, desc: true }], limit: 14,
  });
  let totSales = 0, totRev = 0;
  console.log(`=== VENDAS POR CANAL (GA4, ${start} → ${end}) ===`);
  for (const r of rep.rows || []) {
    const [src, med] = r.dimensionValues!.map((d) => d.value);
    const [s, p, rev] = r.metricValues!.map((m) => Number(m.value));
    totSales += p; totRev += rev;
    if (p > 0 || s > 200) console.log(`  ${(src + " / " + med).padEnd(34)} ${String(s).padStart(6)} sess · ${String(p).padStart(3)} vendas · ${brl(rev)}`);
  }
  console.log(`  ${"—".repeat(60)}`);
  console.log(`  TOTAL site (GA4): ${totSales} vendas · ${brl(totRev)}`);

  // ===== TikTok: status das campanhas =====
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  const token = decrypt(data!.access_token);
  const tget = async (p: string, pr: any) => { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(pr)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); return (await fetch(`${API}${p}?${qs}`, { headers: { "Access-Token": token } })).json(); };
  const today = new Date().toISOString().slice(0, 10);
  const camps = (await tget("/campaign/get/", { advertiser_id: ADV, fields: ["campaign_id", "campaign_name", "operation_status"] })).data?.list || [];
  const cname: Record<string, string> = {}; const cstatus: Record<string, string> = {};
  for (const c2 of camps) { cname[c2.campaign_id] = c2.campaign_name; cstatus[c2.campaign_id] = c2.operation_status; }
  const r2 = await tget("/report/integrated/get/", { advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_CAMPAIGN", dimensions: ["campaign_id"], metrics: ["spend", "complete_payment", "complete_payment_roas"], start_date: start, end_date: today });
  console.log(`\n=== TIKTOK — campanhas (${start} → hoje) ===`);
  const rows = (r2.data?.list || []).filter((x: any) => /TT-ADS|THE SALE|IG Winners|Conversão|Tráfego/i.test(cname[x.dimensions.campaign_id] || "")).sort((a: any, b: any) => Number(b.metrics.spend) - Number(a.metrics.spend));
  for (const r of rows) {
    const nm = cname[r.dimensions.campaign_id] || r.dimensions.campaign_id;
    const m = r.metrics;
    console.log(`  • ${nm} [${cstatus[r.dimensions.campaign_id]}]: gasto ${brl(Number(m.spend))} · ${Number(m.complete_payment)} compras(pixel) · ROAS ${Number(m.complete_payment_roas).toFixed(2)}x`);
  }
  if (!rows.length) console.log("  (sem gasto no período)");
})().catch((e) => console.error("ERRO:", e.message));
