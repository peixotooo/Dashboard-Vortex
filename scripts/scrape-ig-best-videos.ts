/**
 * Raspa os Reels de @bulkingoficial via Apify e ranqueia os melhores vídeos
 * (por views, fallback engajamento) — candidatos a criativo nativo 9:16 pro TikTok.
 *
 * READ-ONLY (só leitura via Apify). Não baixa nada ainda — só lista + dá o videoUrl.
 * Usage: npx tsx scripts/scrape-ig-best-videos.ts [limit]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const HANDLE = "bulkingoficial";
const SAMPLE = parseInt(process.argv[2] || "60", 10);
const TOP_N = 12;

async function getApifyToken(): Promise<string> {
  const envTok = process.env.APIFY_API_TOKEN?.trim();
  if (envTok) return envTok;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb
    .from("apify_connections")
    .select("api_token")
    .eq("workspace_id", WS)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`No apify token: ${error?.message}`);
  return decrypt(data.api_token);
}

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

(async () => {
  const token = await getApifyToken();
  console.log(`Raspando até ${SAMPLE} posts de @${HANDLE} via Apify...\n`);

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${HANDLE}/`],
        resultsType: "posts",
        resultsLimit: SAMPLE,
      }),
    }
  );
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items: any[] = await res.json();
  console.log(`Recebidos ${items.length} posts.`);

  const videos = items
    .filter((p) => {
      const t = String(p.type || p.productType || p.mediaType || "").toLowerCase();
      return t.includes("video") || t.includes("reel") || p.videoUrl || p.videoPlayCount != null;
    })
    .map((p) => ({
      url: p.url || `https://www.instagram.com/p/${p.shortCode || p.code}/`,
      videoUrl: p.videoUrl || p.video_url || "",
      views: n(p.videoPlayCount ?? p.videoViewCount ?? p.playCount ?? p.views),
      likes: n(p.likesCount ?? p.likes),
      comments: n(p.commentsCount ?? p.comments),
      duration: n(p.videoDuration ?? p.duration),
      timestamp: p.timestamp || p.takenAtTimestamp || "",
      caption: String(p.caption || p.text || "").replace(/\s+/g, " ").slice(0, 90),
    }));

  console.log(`Vídeos/Reels: ${videos.length}\n`);
  if (!videos.length) { console.log("Nenhum vídeo retornado (o actor pode ter limitado)."); return; }

  // Engajamento como score: views é o melhor sinal; se ausente, likes+comments.
  const score = (v: any) => (v.views > 0 ? v.views : (v.likes + v.comments * 3) * 10);
  const top = [...videos].sort((a, b) => score(b) - score(a)).slice(0, TOP_N);

  console.log(`===== TOP ${top.length} vídeos (por views / engajamento) =====`);
  top.forEach((v, i) => {
    const engRate = v.views > 0 ? (((v.likes + v.comments) / v.views) * 100).toFixed(1) + "% eng" : "";
    console.log(
      `\n${i + 1}. ${v.url}` +
      `\n   ${v.views ? v.views.toLocaleString("pt-BR") + " views" : "(views n/d)"} · ` +
      `${v.likes.toLocaleString("pt-BR")} likes · ${v.comments.toLocaleString("pt-BR")} coments ` +
      `${engRate ? "· " + engRate : ""}${v.duration ? " · " + v.duration + "s" : ""}` +
      `\n   "${v.caption}"` +
      `\n   ${v.videoUrl ? "✅ baixável" : "❌ sem videoUrl"}`
    );
  });

  const withUrl = top.filter((v) => v.videoUrl).length;
  console.log(`\n\n${withUrl}/${top.length} têm URL de vídeo baixável (prontos pra re-upload no TikTok).`);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
