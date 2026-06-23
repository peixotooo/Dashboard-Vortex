/**
 * READ-ONLY: extrai os criativos da campanha THE SALE (Meta/BK BACKUP) e checa o que
 * é baixável pra re-upload no TikTok. Salva inventário em scripts/.thesale-creatives.json
 * Usage: npx tsx scripts/pull-thesale-creatives.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
import { writeFileSync } from "fs";
config({ path: ".env.local" });

const BASE = "https://graph.facebook.com/v23.0";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ACC = "act_1613880720305953"; // BK BACKUP

async function token(): Promise<string> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("meta_connections").select("access_token").eq("workspace_id", WS).order("created_at", { ascending: false }).limit(1).single();
  return decrypt(data!.access_token);
}
async function g(path: string, t: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const d = await (await fetch(`${BASE}${path}${sep}access_token=${t}`)).json();
  if (d.error) throw new Error(d.error.message);
  return d;
}

(async () => {
  const t = await token();
  // acha TODAS as campanhas THE SALE
  const camps = await g(`/${ACC}/campaigns?fields=id,name&limit=300`, t);
  const matches = (camps.data || []).filter((c: any) => /the\s*sale/i.test(c.name));
  if (!matches.length) { console.log("THE SALE não encontrada"); return; }
  console.log(`Campanhas THE SALE: ${matches.map((c: any) => c.name).join(" | ")}\n`);

  const adList: any[] = [];
  for (const camp of matches) {
    const ads = await g(`/${camp.id}/ads?limit=30&fields=name,effective_status,creative{id,image_url,image_hash,video_id,body,title,object_type,object_story_spec,asset_feed_spec}`, t);
    for (const ad of ads.data || []) adList.push(ad);
  }
  const assets: any[] = [];
  const seenImg = new Set<string>(), seenVid = new Set<string>();
  for (const ad of adList) {
    const cr = ad.creative || {};
    const imgs = new Set<string>();
    const vids = new Set<string>();
    if (cr.image_url) imgs.add(cr.image_url);
    if (cr.video_id) vids.add(cr.video_id);
    // object_story_spec
    const oss = cr.object_story_spec || {};
    if (oss.video_data?.video_id) vids.add(oss.video_data.video_id);
    if (oss.link_data?.image_hash) {/* hash precisa resolver */}
    if (oss.link_data?.picture) imgs.add(oss.link_data.picture);
    // asset_feed_spec (flexible/advantage+)
    const afs = cr.asset_feed_spec || {};
    for (const v of afs.videos || []) if (v.video_id) vids.add(v.video_id);
    for (const im of afs.images || []) if (im.url) imgs.add(im.url);

    // dedupe global
    const newImgs = [...imgs].filter((u) => !seenImg.has(u));
    newImgs.forEach((u) => seenImg.add(u));
    const newVids = [...vids].filter((v) => !seenVid.has(v));
    newVids.forEach((v) => seenVid.add(v));
    if (!newImgs.length && !newVids.length) continue;

    // probe video sources (baixável?)
    const videoOut: any[] = [];
    for (const vid of newVids) {
      try { const v = await g(`/${vid}?fields=source,length`, t); videoOut.push({ video_id: vid, source: v.source || null, length: v.length || null }); }
      catch (e: any) { videoOut.push({ video_id: vid, source: null, err: e.message }); }
    }
    assets.push({ ad: ad.name, status: ad.effective_status, body: cr.body || afs.bodies?.[0]?.text || "", title: cr.title || afs.titles?.[0]?.text || "", images: newImgs, videos: videoOut });
  }

  console.log(`=== Criativos THE SALE (${assets.length} ads) ===`);
  let dlImg = 0, dlVid = 0;
  for (const a of assets) {
    const okV = a.videos.filter((v: any) => v.source).length;
    dlImg += a.images.length; dlVid += okV;
    console.log(`\n• ${a.ad} [${a.status}]`);
    if (a.body) console.log(`  copy: "${String(a.body).replace(/\s+/g, " ").slice(0, 90)}"`);
    console.log(`  imagens baixáveis: ${a.images.length} | vídeos baixáveis: ${okV}/${a.videos.length}`);
  }
  console.log(`\nTOTAL baixável → ${dlImg} imagens, ${dlVid} vídeos`);
  writeFileSync("scripts/.thesale-creatives.json", JSON.stringify(assets, null, 2));
  console.log("💾 salvo em scripts/.thesale-creatives.json");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
