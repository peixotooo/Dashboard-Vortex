/** READ-ONLY: desempenho da campanha de vendas (campanha + por anúncio) + saldo. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const CAMPAIGN = "1867658423725202";
const ADGROUP = "1867660835334353";
const START = "2026-06-11";
const END = process.argv[2] || new Date().toISOString().slice(0, 10);

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  const token = decrypt(data!.access_token);
  const get = async (p: string, params: any) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    return (await fetch(`${API}${p}?${qs}`, { headers: { "Access-Token": token } })).json();
  };
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const METRICS = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "conversion", "cost_per_conversion", "complete_payment", "complete_payment_roas"];

  // Campanha (agregado do período)
  const camp = await get("/report/integrated/get/", {
    advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_CAMPAIGN",
    dimensions: ["campaign_id"], metrics: METRICS, start_date: START, end_date: END,
  });
  const row = (camp.data?.list || []).find((x: any) => x.dimensions?.campaign_id === CAMPAIGN);
  const m = row?.metrics || {};
  console.log(`=== CAMPANHA (${START} a ${END}) ===`);
  if (!row) { console.log(camp.code !== 0 ? `report erro: ${camp.code} ${camp.message}` : "sem dados ainda"); }
  else {
    console.log(`Gasto:        R$ ${br(num(m.spend))}`);
    console.log(`Impressões:   ${num(m.impressions).toLocaleString("pt-BR")}  | Alcance: ${num(m.reach).toLocaleString("pt-BR")}`);
    console.log(`Cliques:      ${num(m.clicks).toLocaleString("pt-BR")}  | CTR: ${num(m.ctr).toFixed(2)}%  | CPC: R$ ${br(num(m.cpc))}  | CPM: R$ ${br(num(m.cpm))}`);
    console.log(`Conversões:   ${num(m.conversion)}  | Custo/conv: R$ ${br(num(m.cost_per_conversion))}`);
    console.log(`Compras:      ${num(m.complete_payment)}  | ROAS: ${num(m.complete_payment_roas).toFixed(2)}x`);
  }

  // Por anúncio
  const ads = await get("/report/integrated/get/", {
    advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_AD",
    dimensions: ["ad_id"], metrics: ["spend", "impressions", "clicks", "ctr", "complete_payment", "complete_payment_roas"],
    start_date: START, end_date: END,
  });
  // nomes
  const meta = await get("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["ad_id", "ad_name"] });
  const names: Record<string, string> = {};
  for (const a of meta.data?.list || []) names[a.ad_id] = a.ad_name;
  console.log(`\n=== POR ANÚNCIO ===`);
  const rows = (ads.data?.list || []).filter((x: any) => names[x.dimensions?.ad_id]).sort((a: any, b: any) => num(b.metrics.spend) - num(a.metrics.spend));
  if (!rows.length) console.log("sem dados por anúncio ainda");
  for (const r of rows) {
    const a = r.metrics;
    console.log(`• ${names[r.dimensions.ad_id]}: R$ ${br(num(a.spend))} | ${num(a.impressions).toLocaleString("pt-BR")} impr | CTR ${num(a.ctr).toFixed(2)}% | ${num(a.complete_payment)} compras | ROAS ${num(a.complete_payment_roas).toFixed(2)}x`);
  }
})().catch((e) => console.error("ERRO:", e.message));
