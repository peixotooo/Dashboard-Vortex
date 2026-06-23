/**
 * Ativa a campanha THE SALE (campanha+adgroup+ads) e pausa, na IG Winners, só os
 * anúncios SEM venda (complete_payment=0). Usage: npx tsx scripts/activate-thesale-prune-winners.ts [--confirm]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const WINNERS_AG = "1867660835334353";
const SALE_CAMP = "1868802227474513";
const SALE_AG = "1868802199482834";
const START = "2026-06-11", END = new Date().toISOString().slice(0, 10);
const CONFIRM = process.argv.includes("--confirm");

let TOKEN = "";
async function tt(path: string, params: any, method: "GET" | "POST" = "POST"): Promise<any> {
  let url = `${API}${path}`; const init: any = { method, headers: { "Access-Token": TOKEN, "Content-Type": "application/json" } };
  if (method === "GET") { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); url += `?${qs}`; }
  else init.body = JSON.stringify(params);
  const j = await (await fetch(url, init)).json();
  if (j.code !== 0) throw new Error(`[${path}] ${j.code}: ${j.message}`);
  return j.data;
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  TOKEN = decrypt(data!.access_token);

  // ads da IG Winners
  const wAds = (await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [WINNERS_AG] }, fields: ["ad_id", "ad_name", "operation_status"] }, "GET")).list || [];
  // vendas por ad
  const rep = (await tt("/report/integrated/get/", { advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_AD", dimensions: ["ad_id"], metrics: ["spend", "complete_payment"], start_date: START, end_date: END }, "GET")).list || [];
  const salesById: Record<string, { sales: number; spend: number }> = {};
  for (const r of rep) salesById[r.dimensions.ad_id] = { sales: Number(r.metrics.complete_payment || 0), spend: Number(r.metrics.spend || 0) };

  console.log("=== IG WINNERS — decisão por anúncio ===");
  const toPause: string[] = [];
  for (const a of wAds) {
    const m = salesById[a.ad_id] || { sales: 0, spend: 0 };
    const keep = m.sales > 0;
    console.log(`  ${keep ? "🟢 manter" : "⏸️  pausar"} ${a.ad_name} — ${m.sales} venda(s), R$ ${m.spend.toFixed(2)} gasto`);
    if (!keep && a.operation_status !== "DISABLE") toPause.push(a.ad_id);
  }

  // ads da THE SALE
  const saleAds = (await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [SALE_AG] }, fields: ["ad_id", "ad_name"] }, "GET")).list || [];
  console.log(`\n=== THE SALE — vai ATIVAR campanha + adgroup + ${saleAds.length} ads ===`);
  saleAds.forEach((a: any) => console.log(`  ▶️  ${a.ad_name}`));

  if (!CONFIRM) { console.log("\n[DRY-RUN] Rode com --confirm pra executar."); return; }

  // 1) ativa THE SALE (3 níveis)
  await tt("/campaign/status/update/", { advertiser_id: ADV, campaign_ids: [SALE_CAMP], operation_status: "ENABLE" });
  await tt("/adgroup/status/update/", { advertiser_id: ADV, adgroup_ids: [SALE_AG], operation_status: "ENABLE" });
  await tt("/ad/status/update/", { advertiser_id: ADV, ad_ids: saleAds.map((a: any) => a.ad_id), operation_status: "ENABLE" });
  console.log("\n✅ THE SALE ATIVADA (campanha + adgroup + ads)");

  // 2) pausa os ads sem venda da IG Winners
  if (toPause.length) {
    await tt("/ad/status/update/", { advertiser_id: ADV, ad_ids: toPause, operation_status: "DISABLE" });
    console.log(`✅ IG Winners: ${toPause.length} anúncios sem venda PAUSADOS`);
  } else console.log("IG Winners: nenhum anúncio pra pausar (todos venderam ou já pausados)");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
