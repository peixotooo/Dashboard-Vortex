/**
 * Cria UMA campanha de Ads no TikTok (WEB_CONVERSIONS → bulking.com.br) usando os
 * melhores Reels do @bulkingoficial como criativo nativo 9:16. Poucas e boas:
 * 1 campanha → 1 adgroup broad → N ads (top Reels, sem Black Bulking). Tudo PAUSADO.
 *
 * Lê o token DURÁVEL de tiktok_credentials (já persistido) — não precisa de auth_code.
 *
 * Dry-run (default): só mostra o plano, não escreve nada.
 *   npx tsx scripts/create-tiktok-ads-from-ig.ts
 * Criar de verdade (pausado): exige --confirm e (pro adgroup/ads) o pixel.
 *   TIKTOK_PIXEL_ID=... TIKTOK_OPT_EVENT=ON_WEB_ORDER \
 *     npx tsx scripts/create-tiktok-ads-from-ig.ts --confirm
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

config({ path: ".env.local" });

// Estado p/ resume idempotente (não recria campanha / não re-sobe vídeos no retry)
const STATE_FILE = "scripts/.tiktok-create-state.json";
function loadState(): any { try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}; } catch { return {}; } }
function saveState(s: any) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADVERTISER = "7246116612330242049"; // BULKING 2.0
const IDENTITY_ID = "e6d59b28-9ee4-5a85-b725-209ccdc863a1";
const IDENTITY_TYPE = "TT_USER";
const LANDING = "https://bulking.com.br";
const DAILY_BUDGET = 50; // R$/dia (adgroup)
const N_ADS = 5;
const APIFY_HANDLE = "bulkingoficial";

const CONFIRM = process.argv.includes("--confirm");
const PIXEL_ID = process.env.TIKTOK_PIXEL_ID?.trim() || "";
const OPT_EVENT = process.env.TIKTOK_OPT_EVENT?.trim() || "ON_WEB_ORDER"; // compra
const OBJECTIVE = (process.env.TIKTOK_OBJECTIVE?.trim() || "WEB_CONVERSIONS").toUpperCase(); // ou TRAFFIC
const IS_TRAFFIC = OBJECTIVE === "TRAFFIC";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getTikTokToken(): Promise<string> {
  const { data, error } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  if (error || !data) throw new Error(`Sem token TikTok persistido: ${error?.message}. Rode tiktok-connect-and-probe.ts`);
  return decrypt(data.access_token);
}
async function getApifyToken(): Promise<string> {
  const { data } = await sb.from("apify_connections").select("api_token").eq("workspace_id", WS).order("created_at", { ascending: false }).limit(1).single();
  if (!data) throw new Error("Sem token Apify");
  return decrypt(data.api_token);
}

let TOKEN = "";
async function tt(path: string, params: any, method: "GET" | "POST" = "POST"): Promise<any> {
  let url = `${API}${path}`;
  const init: any = { method, headers: { "Access-Token": TOKEN, "Content-Type": "application/json" } };
  if (method === "GET") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) { if (v == null) continue; qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); }
    url += `?${qs}`;
  } else init.body = JSON.stringify(params);
  const json = await (await fetch(url, init)).json();
  if (json.code !== 0) throw new Error(`[${path}] code ${json.code}: ${json.message}`);
  return json.data;
}

// Upload por URL (tenta) com fallback download+arquivo(MD5)
async function uploadVideo(videoUrl: string, name: string): Promise<string> {
  // 1) UPLOAD_BY_URL
  try {
    const fd = new FormData();
    fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_URL");
    fd.set("video_url", videoUrl); fd.set("file_name", name);
    const j = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
    if (j.code === 0) return (Array.isArray(j.data) ? j.data[0] : j.data).video_id;
    console.log(`    url-upload falhou (${j.code} ${j.message}); baixando arquivo...`);
  } catch (e: any) { console.log(`    url-upload erro (${e.message}); baixando...`); }
  // 2) UPLOAD_BY_FILE
  const buf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
  const sig = createHash("md5").update(buf).digest("hex");
  const fd = new FormData();
  fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_FILE");
  fd.set("video_signature", sig); fd.set("file_name", name);
  fd.set("video_file", new Blob([buf]), name);
  const j = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`video upload: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).video_id;
}
async function uploadImage(imageUrl: string, name: string): Promise<string> {
  const fd = new FormData();
  fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_URL");
  fd.set("image_url", imageUrl); fd.set("file_name", name);
  const j = await (await fetch(`${API}/file/image/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`image upload: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).image_id;
}

async function scrapeTopVideos(): Promise<any[]> {
  const apify = await getApifyToken();
  const items: any[] = await (await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apify}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directUrls: [`https://www.instagram.com/${APIFY_HANDLE}/`], resultsType: "posts", resultsLimit: 60 }) }
  )).json();
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return items
    .filter((p) => { const t = String(p.type || p.productType || "").toLowerCase(); return (t.includes("video") || p.videoUrl) && p.videoUrl; })
    .filter((p) => !/black\s*bulking|black\s*friday/i.test(String(p.caption || ""))) // sem Black Bulking
    .map((p) => ({ url: p.url, videoUrl: p.videoUrl, cover: p.displayUrl || p.imageUrl, views: n(p.videoPlayCount ?? p.videoViewCount), caption: String(p.caption || "").replace(/\s+/g, " ").trim() }))
    .sort((a, b) => b.views - a.views)
    .slice(0, N_ADS);
}

function adText(caption: string): string {
  // copy curta nativa pt-BR (placeholder editável); evita texto longo do IG
  const base = caption.split(/[.!\n]/)[0].slice(0, 70).trim();
  return (base || "Bulking — estilo e performance") + " 🖤 Use o site.";
}

(async () => {
  TOKEN = await getTikTokToken();
  console.log(`Conta: BULKING 2.0 (${ADVERTISER}) | identity ${IDENTITY_TYPE} ${IDENTITY_ID}`);
  console.log(`Orçamento ${DAILY_BUDGET}/dia | destino ${LANDING} | ${N_ADS} ads | objetivo WEB_CONVERSIONS\n`);

  const videos = await scrapeTopVideos();
  console.log(`Top ${videos.length} Reels selecionados (sem Black Bulking):`);
  videos.forEach((v, i) => console.log(`  ${i + 1}. ${v.views.toLocaleString("pt-BR")} views — "${v.caption.slice(0, 60)}" → ${v.url}`));

  if (!CONFIRM) {
    console.log(`\n[DRY-RUN] Nada criado. Rode com --confirm pra subir (pausado).`);
    if (!PIXEL_ID) console.log(`⚠️ Sem TIKTOK_PIXEL_ID: o adgroup WEB_CONVERSIONS precisa do pixel. Defina TIKTOK_PIXEL_ID.`);
    return;
  }

  const state = loadState();

  // 1) Upload criativos (resume: reaproveita do estado)
  console.log(`\n=== Upload dos criativos ===`);
  let creatives: { video_id: string; cover_id: string; caption: string }[] = state.creatives || [];
  if (creatives.length) {
    console.log(`  (resume) ${creatives.length} criativos já enviados — pulando upload.`);
  } else {
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      console.log(`  [${i + 1}/${videos.length}] ${v.url}`);
      const video_id = await uploadVideo(v.videoUrl, `ig_${i + 1}.mp4`);
      let cover_id = "";
      try { cover_id = await uploadImage(v.cover, `ig_${i + 1}.jpg`); } catch (e: any) { console.log(`    cover falhou: ${e.message}`); }
      console.log(`    ✅ video_id ${video_id}${cover_id ? ` cover ${cover_id}` : ""}`);
      creatives.push({ video_id, cover_id, caption: v.caption });
      state.creatives = creatives; saveState(state);
    }
  }

  // 2) Campanha (pausada) — estado por objetivo (TRAFFIC e WEB_CONVERSIONS são campanhas distintas)
  console.log(`\n=== Campanha (${OBJECTIVE}) ===`);
  state.byObjective = state.byObjective || {};
  // migra estado antigo (flat) -> a campanha WEB_CONVERSIONS já criada, pra não duplicar depois
  if (state.campaign_id && !state.byObjective.WEB_CONVERSIONS) {
    state.byObjective.WEB_CONVERSIONS = { campaign_id: state.campaign_id, adgroup_id: state.adgroup_id };
    delete state.campaign_id; delete state.adgroup_id; saveState(state);
  }
  const st = (state.byObjective[OBJECTIVE] = state.byObjective[OBJECTIVE] || {});
  const camp = { campaign_id: st.campaign_id || process.env.TIKTOK_CAMPAIGN_ID };
  if (camp.campaign_id) {
    console.log(`  (resume) reusando campaign_id ${camp.campaign_id}`);
  } else {
    const c = await tt("/campaign/create/", {
      advertiser_id: ADVERTISER,
      campaign_name: IS_TRAFFIC
        ? "[TT-ADS] Tráfego Site | IG Winners | broad"
        : "[TT-ADS] Conversão Site | IG Winners | broad",
      objective_type: OBJECTIVE,
      budget_mode: "BUDGET_MODE_INFINITE",
      operation_status: "DISABLE",
    });
    camp.campaign_id = c.campaign_id;
    st.campaign_id = c.campaign_id; saveState(state);
    console.log(`  ✅ campaign_id ${camp.campaign_id}`);
  }

  if (!IS_TRAFFIC && !PIXEL_ID) {
    console.log(`\n⚠️ Campanha criada (pausada), mas SEM pixel não dá pra criar o adgroup WEB_CONVERSIONS.`);
    console.log(`   Defina TIKTOK_PIXEL_ID e rode de novo (a campanha já existe; ajusto pra não duplicar).`);
    return;
  }

  // região Brasil
  const regions = await tt("/tool/region/", { advertiser_id: ADVERTISER, placements: ["PLACEMENT_TIKTOK"], objective_type: OBJECTIVE }, "GET");
  const br = (regions.region_info || regions.list || []).find((r: any) => r.region_code === "BR" || /brazil|brasil/i.test(r.name || ""));
  const locationId = br?.location_id || br?.region_id;
  console.log(`  Brasil location_id: ${locationId || "❌ não achei"}`);

  // 3) Adgroup (pausado, broad) — resume se já criado
  console.log(`\n=== Adgroup ===`);
  const ag = { adgroup_id: st.adgroup_id };
  if (ag.adgroup_id) {
    console.log(`  (resume) reusando adgroup_id ${ag.adgroup_id}`);
  } else {
    const now = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 19).replace("T", " ");
    const base: any = {
      advertiser_id: ADVERTISER,
      campaign_id: camp.campaign_id,
      adgroup_name: IS_TRAFFIC ? "Broad | BR | Tráfego" : "Broad | BR | Compra",
      promotion_type: "WEBSITE",
      placement_type: "PLACEMENT_TYPE_NORMAL",
      placements: ["PLACEMENT_TIKTOK"],
      location_ids: locationId ? [String(locationId)] : undefined,
      gender: "GENDER_UNLIMITED",
      bid_type: "BID_TYPE_NO_BID",
      pacing: "PACING_MODE_SMOOTH", // entrega uniforme (acelerada não é aceita c/ no-bid em conversão)
      budget_mode: "BUDGET_MODE_DAY",
      budget: DAILY_BUDGET,
      schedule_type: "SCHEDULE_FROM_NOW",
      schedule_start_time: now,
      operation_status: "DISABLE",
    };
    const a = await tt("/adgroup/create/", IS_TRAFFIC
      ? { ...base, optimization_goal: "CLICK", billing_event: "CPC" }
      : { ...base, pixel_id: PIXEL_ID, optimization_event: OPT_EVENT, optimization_goal: "CONVERT", billing_event: "OCPM" });
    ag.adgroup_id = a.adgroup_id;
    st.adgroup_id = a.adgroup_id; saveState(state);
    console.log(`  ✅ adgroup_id ${ag.adgroup_id}`);
  }

  // 4) Ads (pausados)
  console.log(`\n=== Ads ===`);
  for (let i = 0; i < creatives.length; i++) {
    const c = creatives[i];
    try {
      const ad = await tt("/ad/create/", {
        advertiser_id: ADVERTISER,
        adgroup_id: ag.adgroup_id,
        creatives: [{
          ad_name: `IG Winner ${i + 1}`,
          identity_id: IDENTITY_ID,
          identity_type: IDENTITY_TYPE,
          ad_format: "SINGLE_VIDEO",
          video_id: c.video_id,
          image_ids: c.cover_id ? [c.cover_id] : undefined,
          ad_text: adText(c.caption),
          call_to_action: "SHOP_NOW",
          landing_page_url: LANDING,
          operation_status: "DISABLE",
        }],
      });
      console.log(`  ✅ ad ${i + 1} criado`);
    } catch (e: any) { console.log(`  ❌ ad ${i + 1}: ${e.message}`); }
  }

  console.log(`\n🎉 Pronto — campanha + adgroup + ads criados PAUSADOS na BULKING 2.0. Revise no Ads Manager e ative.`);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
