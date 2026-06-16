/** READ-ONLY: estado real da campanha de vendas + revisão dos ads + saldo da conta. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const CAMPAIGN = "1867658423725202";
const ADGROUP = "1867660835334353";

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  const token = decrypt(data!.access_token);
  const get = async (p: string, params: any) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    return (await fetch(`${API}${p}?${qs}`, { headers: { "Access-Token": token } })).json();
  };

  // Saldo / conta
  const inf = await get("/advertiser/info/", { advertiser_ids: [ADV], fields: ["name", "status", "balance", "currency", "display_timezone", "rejection_reason"] });
  const a = Array.isArray(inf.data) ? inf.data[0] : (inf.data?.list?.[0] || inf.data);
  console.log("=== CONTA BULKING 2.0 ===");
  console.log(inf.code === 0 ? JSON.stringify(a) : `❌ ${inf.code} ${inf.message}`);

  // Campanha
  const c = await get("/campaign/get/", { advertiser_id: ADV, filtering: { campaign_ids: [CAMPAIGN] }, fields: ["campaign_name", "operation_status", "secondary_status"] });
  console.log("\n=== CAMPANHA ===");
  console.log(JSON.stringify(c.data?.list?.[0]));

  // Adgroup (secondary_status mostra entrega / saldo / review)
  const ag = await get("/adgroup/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["adgroup_name", "operation_status", "secondary_status", "budget", "optimization_event"] });
  console.log("\n=== ADGROUP ===");
  console.log(JSON.stringify(ag.data?.list?.[0]));

  // Ads (review por anúncio)
  const ads = await get("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["ad_name", "operation_status", "secondary_status"] });
  console.log("\n=== ADS (revisão) ===");
  for (const ad of ads.data?.list || []) console.log(`  • ${ad.ad_name}: ${ad.operation_status} / ${ad.secondary_status}`);
})().catch((e) => console.error("ERRO:", e.message));
