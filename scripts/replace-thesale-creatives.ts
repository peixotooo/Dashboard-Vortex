/**
 * Substitui os criativos dos 3 anúncios THE SALE pelos ORIGINAIS nativos 9:16
 * (pasta do usuário): 2 vídeos verticais + slideshow das 5 imagens 1080x1920.
 * Edição ad-level (não reseta o grupo). Usage: npx tsx scripts/replace-thesale-creatives.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
import { createHash } from "crypto";
import { execSync as exec } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const ADGROUP = "1868802199482834";
const SRC = "/Users/guilhermepeixoto/Downloads/THE SALE PROMO ads";
const TMP = "/tmp/thesale-native";
const VIDEOS = ["THE SALE PROMO ads.mp4", "THE SALE PROMO ads - cópia.mp4"]; // 28s, 13s
const IMAGES = ["1.png", "2.png", "3.png", "4.png", "5.png"];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let TOKEN = "";
async function tt(path: string, params: any, method: "GET" | "POST" = "POST"): Promise<any> {
  let url = `${API}${path}`; const init: any = { method, headers: { "Access-Token": TOKEN, "Content-Type": "application/json" } };
  if (method === "GET") { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); url += `?${qs}`; }
  else init.body = JSON.stringify(params);
  const j = await (await fetch(url, init)).json();
  if (j.code !== 0) throw new Error(`[${path}] ${j.code}: ${j.message}`);
  return j.data;
}
async function uploadVideoFile(p: string, name: string): Promise<string> {
  const buf = readFileSync(p); const fd = new FormData();
  fd.set("advertiser_id", ADV); fd.set("upload_type", "UPLOAD_BY_FILE");
  fd.set("video_signature", createHash("md5").update(buf).digest("hex")); fd.set("file_name", name);
  fd.set("video_file", new Blob([buf]), name);
  const j = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`video: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).video_id;
}
async function uploadImageFile(p: string, name: string): Promise<string> {
  const buf = readFileSync(p); const fd = new FormData();
  fd.set("advertiser_id", ADV); fd.set("upload_type", "UPLOAD_BY_FILE");
  fd.set("image_signature", createHash("md5").update(buf).digest("hex")); fd.set("file_name", name);
  fd.set("image_file", new Blob([buf]), name);
  const j = await (await fetch(`${API}/file/image/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (j.code !== 0) throw new Error(`image: ${j.code} ${j.message}`);
  return (Array.isArray(j.data) ? j.data[0] : j.data).image_id;
}

(async () => {
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  TOKEN = decrypt(data!.access_token);
  mkdirSync(TMP, { recursive: true });

  // 1) vídeos nativos
  console.log("Upload dos 2 vídeos nativos...");
  const vids: string[] = [];
  for (let i = 0; i < VIDEOS.length; i++) vids.push(await uploadVideoFile(`${SRC}/${VIDEOS[i]}`, `sale_native_${i + 1}.mp4`));
  console.log(`  ✅ ${vids.join(", ")}`);

  // 2) slideshow das 5 imagens 1080x1920 (sem padding — já são verticais)
  console.log("Slideshow das 5 imagens...");
  IMAGES.forEach((im, i) => copyFileSync(`${SRC}/${im}`, `${TMP}/f_${i}.png`));
  const list = IMAGES.map((_, i) => `file '${TMP}/f_${i}.png'\nduration 2.6`).join("\n") + `\nfile '${TMP}/f_${IMAGES.length - 1}.png'\n`;
  writeFileSync(`${TMP}/list.txt`, list);
  exec(`ffmpeg -y -loglevel error -f concat -safe 0 -i ${TMP}/list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${TMP}/slideshow.mp4`);
  const slideId = await uploadVideoFile(`${TMP}/slideshow.mp4`, "sale_native_slideshow.mp4");
  const coverId = await uploadImageFile(`${SRC}/${IMAGES[0]}`, "sale_native_cover.jpg");
  console.log(`  ✅ slideshow ${slideId} | capa ${coverId}`);

  // 3) substitui nos 3 anúncios existentes (ad-level update, não reseta)
  const map: Record<string, string> = { "THE SALE vídeo 1": vids[0], "THE SALE vídeo 2": vids[1], "THE SALE slideshow": slideId };
  const got = await tt("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["ad_id", "ad_name", "identity_id", "identity_type", "ad_format", "ad_text", "call_to_action", "landing_page_url"] }, "GET");
  for (const ad of got.data?.list || []) {
    const newVid = map[ad.ad_name]; if (!newVid) continue;
    await tt("/ad/update/", { advertiser_id: ADV, adgroup_id: ADGROUP, creatives: [{ ad_id: ad.ad_id, ad_name: ad.ad_name, identity_id: ad.identity_id, identity_type: ad.identity_type, ad_format: "SINGLE_VIDEO", video_id: newVid, image_ids: [coverId], ad_text: ad.ad_text, call_to_action: ad.call_to_action, landing_page_url: ad.landing_page_url }] });
    console.log(`  ✅ ${ad.ad_name} → criativo nativo (volta pra revisão)`);
  }
  console.log("\n🎉 THE SALE agora com os criativos ORIGINAIS nativos 9:16. Pausada — revise e ative.");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
