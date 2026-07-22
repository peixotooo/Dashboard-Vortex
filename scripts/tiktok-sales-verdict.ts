/** READ-ONLY: vendas/ROAS no TikTok (pixel) por campanha + por anúncio da THE SALE, vs breakeven. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const SALE_CAMP = "1868802227474513";
const WINNERS_CAMP = "1867658423725202";
const SALE_AG = "1868802199482834";
const BREAKEVEN = 4.7; // nosso ROAS de breakeven (auditoria Meta)
const START = "2026-06-11", END = new Date().toISOString().slice(0, 10);

let TOKEN = "";
async function tt(p: string, pr: any) { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(pr)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); const j = await (await fetch(`${API}${p}?${qs}`, { headers: { "Access-Token": TOKEN } })).json(); if (j.code !== 0) throw new Error(`${j.code} ${j.message}`); return j.data; }
const brl = (n: number) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  TOKEN = decrypt(data!.access_token);

  const rep = (await tt("/report/integrated/get/", { advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_CAMPAIGN", dimensions: ["campaign_id"], metrics: ["spend", "complete_payment", "complete_payment_roas", "impressions", "clicks", "ctr"], start_date: START, end_date: END })).list || [];
  const byId: Record<string, any> = {}; for (const r of rep) byId[r.dimensions.campaign_id] = r.metrics;

  const show = (label: string, m: any) => {
    if (!m) { console.log(`\n${label}: sem dados`); return; }
    const spend = Number(m.spend), sales = Number(m.complete_payment), roas = Number(m.complete_payment_roas);
    const rev = spend * roas;
    console.log(`\n${label}`);
    console.log(`  gasto ${brl(spend)} · ${sales} vendas(pixel) · receita(pixel) ${brl(rev)} · ROAS ${roas.toFixed(2)}x · CTR ${Number(m.ctr).toFixed(2)}%`);
    console.log(`  vs breakeven ${BREAKEVEN}x → ${roas >= BREAKEVEN ? "🟢 ACIMA (lucro)" : "🔴 ABAIXO (prejuízo)"} | amostra: ${sales} venda(s) ${sales < 10 ? "(insuficiente p/ decidir)" : "(ok)"}`);
  };
  show("THE SALE | 3 por 199", byId[SALE_CAMP]);
  show("IG Winners (4 ads mantidos)", byId[WINNERS_CAMP]);

  // por anúncio THE SALE
  const wAds = (await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [SALE_AG] }, fields: ["ad_id", "ad_name"] })).list || [];
  const nm: Record<string, string> = {}; for (const a of wAds) nm[a.ad_id] = a.ad_name;
  const adRep = (await tt("/report/integrated/get/", { advertiser_id: ADV, report_type: "BASIC", data_level: "AUCTION_AD", dimensions: ["ad_id"], metrics: ["spend", "complete_payment", "complete_payment_roas", "ctr"], start_date: START, end_date: END })).list || [];
  console.log(`\n=== THE SALE por anúncio ===`);
  for (const r of adRep.filter((x: any) => nm[x.dimensions.ad_id]).sort((a: any, b: any) => Number(b.metrics.spend) - Number(a.metrics.spend))) {
    const m = r.metrics; console.log(`  • ${nm[r.dimensions.ad_id]}: ${brl(Number(m.spend))} · ${Number(m.complete_payment)} vendas · ROAS ${Number(m.complete_payment_roas).toFixed(2)}x · CTR ${Number(m.ctr).toFixed(2)}%`);
  }
})().catch((e) => console.error("ERRO:", e.message));
