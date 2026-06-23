/** Aplica os criativos nativos já enviados nos 3 anúncios THE SALE (match robusto por substring). */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const ADGROUP = "1868802199482834";
const V1 = "v10033g50000d8tahdnog65lofljkhv0"; // 28s
const V2 = "v10033g50000d8tahg7og65h45nqpng0"; // 13s
const SLIDE = "v10033g50000d8tahifog65qrk9cgds0"; // slideshow
const COVER = "ad-site-i18n-sg/20260623c7c7f591e0aca949421d87f9";

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

  const got = await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["ad_id", "ad_name", "identity_id", "identity_type", "ad_text", "call_to_action", "landing_page_url"] }, "GET");
  for (const ad of got.list || []) {
    const n = String(ad.ad_name).toLowerCase();
    const vid = n.includes("slide") ? SLIDE : n.includes("2") ? V2 : n.includes("1") ? V1 : null;
    if (!vid) { console.log(`• ${ad.ad_name}: sem match — pulando`); continue; }
    await tt("/ad/update/", { advertiser_id: ADV, adgroup_id: ADGROUP, creatives: [{ ad_id: ad.ad_id, ad_name: ad.ad_name, identity_id: ad.identity_id, identity_type: ad.identity_type, ad_format: "SINGLE_VIDEO", video_id: vid, image_ids: [COVER], ad_text: ad.ad_text, call_to_action: ad.call_to_action, landing_page_url: ad.landing_page_url }] });
    console.log(`✅ ${ad.ad_name} → ${vid} (nativo)`);
  }
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
