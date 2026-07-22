/**
 * Realoca orçamento pro que paga: sobe THE SALE (+30%), corta IG Winners, pausa slideshow.
 * Dry-run por padrão; --confirm aplica. Usage: npx tsx scripts/tiktok-adjust-budgets.ts [--confirm]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const SALE_AG = "1868802199482834";
const WINNERS_AG = "1867660835334353";
const SALE_NEW = 65;      // R$50 -> R$65 (+30%)
const WINNERS_NEW = 30;   // R$50 -> R$30 (corta o abaixo-breakeven)
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

  // estado atual
  const ags = (await tt("/adgroup/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [SALE_AG, WINNERS_AG] }, fields: ["adgroup_id", "adgroup_name", "budget", "budget_mode"] }, "GET")).list || [];
  const cur: Record<string, any> = {}; for (const a of ags) cur[a.adgroup_id] = a;
  // acha o slideshow
  const saleAds = (await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [SALE_AG] }, fields: ["ad_id", "ad_name", "operation_status"] }, "GET")).list || [];
  const slide = saleAds.find((a: any) => /slide/i.test(a.ad_name));

  console.log("=== PLANO ===");
  console.log(`THE SALE:   R$ ${cur[SALE_AG]?.budget} → R$ ${SALE_NEW}/dia  (+${Math.round((SALE_NEW / cur[SALE_AG]?.budget - 1) * 100)}%)`);
  console.log(`IG Winners: R$ ${cur[WINNERS_AG]?.budget} → R$ ${WINNERS_NEW}/dia  (${Math.round((WINNERS_NEW / cur[WINNERS_AG]?.budget - 1) * 100)}%)`);
  console.log(`slideshow:  ${slide ? `${slide.ad_name} [${slide.operation_status}] → PAUSAR` : "(não achei)"}`);

  if (!CONFIRM) { console.log("\n[DRY-RUN] Rode com --confirm pra aplicar."); return; }

  console.log("\n=== APLICANDO ===");
  await tt("/adgroup/update/", { advertiser_id: ADV, adgroup_id: SALE_AG, budget: SALE_NEW, budget_mode: cur[SALE_AG]?.budget_mode || "BUDGET_MODE_DAY" });
  console.log(`✅ THE SALE → R$ ${SALE_NEW}/dia`);
  await tt("/adgroup/update/", { advertiser_id: ADV, adgroup_id: WINNERS_AG, budget: WINNERS_NEW, budget_mode: cur[WINNERS_AG]?.budget_mode || "BUDGET_MODE_DAY" });
  console.log(`✅ IG Winners → R$ ${WINNERS_NEW}/dia`);
  if (slide && slide.operation_status !== "DISABLE") {
    await tt("/ad/status/update/", { advertiser_id: ADV, ad_ids: [slide.ad_id], operation_status: "DISABLE" });
    console.log(`✅ slideshow pausado`);
  } else console.log("slideshow: já pausado / não encontrado");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
