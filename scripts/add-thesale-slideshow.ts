/**
 * Monta um slideshow 9:16 com as 7 imagens da THE SALE (ffmpeg) e adiciona como 3º
 * anúncio SINGLE_VIDEO no adgroup THE SALE (pausado). Reaproveita o estado existente.
 * Usage: npx tsx scripts/add-thesale-slideshow.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
import { createHash } from "crypto";
import { execSync as exec } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADVERTISER = "7246116612330242049";
const IDENTITY_ID = "e6d59b28-9ee4-5a85-b725-209ccdc863a1";
const LANDING = "https://www.bulking.com.br/the-sale?utm_source=tiktok&utm_medium=paid&utm_campaign=the-sale&utm_content=slideshow";
const AD_TEXT = "THE SALE — leve 3 por R$199. Enquanto durar 🖤";
const TMP = "/tmp/thesale-slideshow";

const st = JSON.parse(readFileSync("scripts/.thesale-tt-state.json", "utf8"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let TOKEN = "";
async function tt(path: string, params: any): Promise<any> {
  const j = await (await fetch(`${API}${path}`, { method: "POST", headers: { "Access-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(params) })).json();
  if (j.code !== 0) throw new Error(`[${path}] ${j.code}: ${j.message}`);
  return j.data;
}

(async () => {
  if (st.ads?.includes("slideshow")) { console.log("slideshow já criado."); return; }
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  TOKEN = decrypt(data!.access_token);

  const creatives = JSON.parse(readFileSync("scripts/.thesale-creatives.json", "utf8"));
  const urls: string[] = [];
  for (const a of creatives) for (const im of a.images || []) urls.push(im);
  console.log(`${urls.length} imagens → slideshow 9:16`);
  mkdirSync(TMP, { recursive: true });

  // 1) baixa + normaliza cada imagem pra 1080x1920
  const frames: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const buf = Buffer.from(await (await fetch(urls[i])).arrayBuffer());
    writeFileSync(`${TMP}/src_${i}.jpg`, buf);
    const out = `${TMP}/f_${String(i).padStart(2, "0")}.png`;
    exec(`ffmpeg -y -loglevel error -i ${TMP}/src_${i}.jpg -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1" ${out}`);
    frames.push(out);
  }
  // 2) concat com 2.5s cada
  const list = frames.map((f) => `file '${f}'\nduration 2.5`).join("\n") + `\nfile '${frames[frames.length - 1]}'\n`;
  writeFileSync(`${TMP}/list.txt`, list);
  const mp4 = `${TMP}/thesale.mp4`;
  exec(`ffmpeg -y -loglevel error -f concat -safe 0 -i ${TMP}/list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${mp4}`);
  const size = exec(`stat -f%z ${mp4}`).toString().trim();
  console.log(`✅ slideshow gerado (${(Number(size) / 1024).toFixed(0)} KB, ${frames.length * 2.5}s)`);

  // 3) upload UPLOAD_BY_FILE
  const buf = readFileSync(mp4);
  const fd = new FormData();
  fd.set("advertiser_id", ADVERTISER); fd.set("upload_type", "UPLOAD_BY_FILE");
  fd.set("video_signature", createHash("md5").update(buf).digest("hex")); fd.set("file_name", "thesale_slideshow.mp4");
  fd.set("video_file", new Blob([buf]), "thesale_slideshow.mp4");
  const up = await (await fetch(`${API}/file/video/ad/upload/`, { method: "POST", headers: { "Access-Token": TOKEN }, body: fd })).json();
  if (up.code !== 0) throw new Error(`upload: ${up.code} ${up.message}`);
  const videoId = (Array.isArray(up.data) ? up.data[0] : up.data).video_id;
  console.log(`✅ upload video_id ${videoId}`);

  // 4) cria ad
  await tt("/ad/create/", { advertiser_id: ADVERTISER, adgroup_id: st.adgroupId, creatives: [{ ad_name: "THE SALE slideshow", identity_id: IDENTITY_ID, identity_type: "TT_USER", ad_format: "SINGLE_VIDEO", video_id: videoId, image_ids: st.imageIds?.[0] ? [st.imageIds[0]] : undefined, ad_text: AD_TEXT, call_to_action: "SHOP_NOW", landing_page_url: LANDING, operation_status: "DISABLE" }] });
  st.ads.push("slideshow"); writeFileSync("scripts/.thesale-tt-state.json", JSON.stringify(st, null, 2));
  console.log(`🎉 ad slideshow criado (pausado). THE SALE agora tem 3 anúncios.`);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
