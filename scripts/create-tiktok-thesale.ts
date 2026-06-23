/**
 * Cria a campanha THE SALE no TikTok Ads (WEB_CONVERSIONS → /the-sale), replicando o
 * vencedor #1 do Meta (oferta "leve 3 por R$199 · enquanto durar"). Usa os criativos
 * REAIS da THE SALE do Meta (scripts/.thesale-creatives.json): 2 vídeos SINGLE_VIDEO +
 * 1 CAROUSEL com as imagens. Tudo PAUSADO. Resume idempotente.
 *
 * Dry-run: npx tsx scripts/create-tiktok-thesale.ts
 * Criar:   npx tsx scripts/create-tiktok-thesale.ts --confirm
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADVERTISER = "7246116612330242049"; // BULKING 2.0
const IDENTITY_ID = "e6d59b28-9ee4-5a85-b725-209ccdc863a1";
const IDENTITY_TYPE = "TT_USER";
const PIXEL_ID = "7246379671393239041";
const OPT_EVENT = "SHOPPING";
const LANDING = "https://www.bulking.com.br/the-sale";
const DAILY_BUDGET = 50;
const AD_TEXT = "THE SALE — leve 3 por R$199. Enquanto durar 🖤";
const CONFIRM = process.argv.includes("--confirm");
const STATE_FILE = "scripts/.thesale-tt-state.json";

const loadState = () => { try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}; } catch { return {}; } };
const saveState = (s: any) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let TOKEN = "";
async function tt(path: string, params: any, method: "GET" | "POST" = "POST"): Promise<any> {
  let url = `${API}${path}`; const init: any = { method, headers: { "Access-Token": TOKEN, "Content-Type": "application/json" } };
  if (method === "GET") { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params || {})) { if (v == null) continue; qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); } url += `?${qs}`; }
  else init.body = JSON.stringify(params);
  const j = await (await fetch(url, init)).json();
  if (j.code !== 0) throw new Error(`[${path}] ${j.code}: ${j.message}`);
  return j.data;
}
async function uploadVideo(src: string, name: string): Promise<string> {
  let fd = new FormData();
  fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_URL"); fd.set("video_url", src); fd.set("file_name", name);
  let j = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code === 0) return (Array.isArray(j.data) ? j.data[0] : j.data).video_id;
  // fallback download
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  fd = new FormData(); fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_FILE");
  fd.set("video_signature", createHash("md5").update(buf).digest("hex")); fd.set("file_name", name); fd.set("video_file", new Blob([buf]), name);
  j = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`video upload: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).video_id;
}
async function uploadImage(src: string, name: string): Promise<string> {
  const fd = new FormData(); fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_URL"); fd.set("image_url", src); fd.set("file_name", name);
  const j = await (await fetch(`${API}/file/image/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`image upload: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).image_id;
}
const utm = (c: string) => `${LANDING}?utm_source=tiktok&utm_medium=paid&utm_campaign=the-sale&utm_content=${c}`;

(async () => {
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  TOKEN = decrypt(data!.access_token);

  const creatives = JSON.parse(readFileSync("scripts/.thesale-creatives.json", "utf8"));
  const videoSrcs: string[] = []; const imageUrls: string[] = [];
  for (const a of creatives) { for (const v of a.videos || []) if (v.source) videoSrcs.push(v.source); for (const im of a.images || []) imageUrls.push(im); }
  console.log(`Criativos THE SALE: ${videoSrcs.length} vídeos + ${imageUrls.length} imagens → /the-sale`);
  console.log(`Conta BULKING 2.0 | pixel ${PIXEL_ID}/${OPT_EVENT} | R$${DAILY_BUDGET}/dia | PAUSADO\n`);

  if (!CONFIRM) { console.log("[DRY-RUN] Rode com --confirm pra criar."); return; }
  const st = loadState();

  // 1) Upload
  if (!st.videoIds) { st.videoIds = []; for (let i = 0; i < videoSrcs.length; i++) { console.log(`upload vídeo ${i + 1}/${videoSrcs.length}`); st.videoIds.push(await uploadVideo(videoSrcs[i], `sale_v${i + 1}.mp4`)); saveState(st); } }
  if (!st.imageIds) { st.imageIds = []; for (let i = 0; i < imageUrls.length; i++) { console.log(`upload imagem ${i + 1}/${imageUrls.length}`); try { st.imageIds.push(await uploadImage(imageUrls[i], `sale_i${i + 1}.jpg`)); } catch (e: any) { console.log(`  img ${i + 1} falhou: ${e.message}`); } saveState(st); } }
  console.log(`✅ ${st.videoIds.length} vídeos, ${st.imageIds.length} imagens no TikTok`);
  const cover = st.imageIds[0]; // capa dos vídeos = 1ª imagem SALE

  // 2) Campanha
  if (!st.campaignId) { const c = await tt("/campaign/create/", { advertiser_id: ADVERTISER, campaign_name: "[TT-ADS] THE SALE | 3 por 199 | broad", objective_type: "WEB_CONVERSIONS", budget_mode: "BUDGET_MODE_INFINITE", operation_status: "DISABLE" }); st.campaignId = c.campaign_id; saveState(st); }
  console.log(`✅ campanha ${st.campaignId}`);

  // 3) Adgroup
  if (!st.adgroupId) {
    const regions = await tt("/tool/region/", { advertiser_id: ADVERTISER, placements: ["PLACEMENT_TIKTOK"], objective_type: "WEB_CONVERSIONS" }, "GET");
    const br = (regions.region_info || regions.list || []).find((r: any) => r.region_code === "BR" || /bra[sz]il/i.test(r.name || ""));
    const now = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 19).replace("T", " ");
    const a = await tt("/adgroup/create/", { advertiser_id: ADVERTISER, campaign_id: st.campaignId, adgroup_name: "Broad | BR | THE SALE", promotion_type: "WEBSITE", placement_type: "PLACEMENT_TYPE_NORMAL", placements: ["PLACEMENT_TIKTOK"], location_ids: br ? [String(br.location_id || br.region_id)] : undefined, gender: "GENDER_UNLIMITED", pixel_id: PIXEL_ID, optimization_event: OPT_EVENT, optimization_goal: "CONVERT", billing_event: "OCPM", bid_type: "BID_TYPE_NO_BID", pacing: "PACING_MODE_SMOOTH", budget_mode: "BUDGET_MODE_DAY", budget: DAILY_BUDGET, schedule_type: "SCHEDULE_FROM_NOW", schedule_start_time: now, operation_status: "DISABLE" });
    st.adgroupId = a.adgroup_id; saveState(st);
  }
  console.log(`✅ adgroup ${st.adgroupId}`);

  // 4) Ads — vídeos (SINGLE_VIDEO)
  st.ads = st.ads || [];
  for (let i = 0; i < st.videoIds.length; i++) {
    const key = `v${i}`; if (st.ads.includes(key)) continue;
    try {
      await tt("/ad/create/", { advertiser_id: ADVERTISER, adgroup_id: st.adgroupId, creatives: [{ ad_name: `THE SALE vídeo ${i + 1}`, identity_id: IDENTITY_ID, identity_type: IDENTITY_TYPE, ad_format: "SINGLE_VIDEO", video_id: st.videoIds[i], image_ids: cover ? [cover] : undefined, ad_text: AD_TEXT, call_to_action: "SHOP_NOW", landing_page_url: utm(`video${i + 1}`), operation_status: "DISABLE" }] });
      st.ads.push(key); saveState(st); console.log(`✅ ad vídeo ${i + 1}`);
    } catch (e: any) { console.log(`❌ ad vídeo ${i + 1}: ${e.message}`); }
  }
  // 4b) Carousel das imagens (best-effort; pode exigir music_id)
  if (!st.ads.includes("carousel") && st.imageIds.length >= 2) {
    const carousel: any = { ad_name: "THE SALE carrossel", identity_id: IDENTITY_ID, identity_type: IDENTITY_TYPE, ad_format: "CAROUSEL", image_ids: st.imageIds, ad_text: AD_TEXT, call_to_action: "SHOP_NOW", landing_page_url: utm("carrossel"), operation_status: "DISABLE" };
    try { await tt("/ad/create/", { advertiser_id: ADVERTISER, adgroup_id: st.adgroupId, creatives: [carousel] }); st.ads.push("carousel"); saveState(st); console.log(`✅ ad carrossel (${st.imageIds.length} imagens)`); }
    catch (e: any) { console.log(`⚠️ carrossel não criado: ${e.message}\n   (provável dependência de music_id — vídeos já estão no ar pausados)`); }
  }

  console.log(`\n🎉 THE SALE no TikTok criada PAUSADA. Revise e ative.`);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
