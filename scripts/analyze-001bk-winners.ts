/**
 * READ-ONLY analysis of the best campaigns + creatives in 001BK
 * (act_880937624549391) to decide what to bring to TikTok.
 *
 * Ranks campaigns by purchase ROAS (lifetime) with a spend floor, then inspects
 * the top campaigns' creatives to classify video vs image and find downloadable
 * video sources (the "creative bridge" to TikTok).
 *
 * Usage: npx tsx scripts/analyze-001bk-winners.ts
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const API_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
// 001BK (act_880937624549391) is disabled/inaccessible — analyze BK COM, which
// holds the cloned 001BK winners plus its own live campaigns.
const SRC_ACCOUNT = "act_1232344655348024";
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const MIN_SPEND = 300; // lifetime spend floor to qualify
const TOP_N = 8;

async function getToken(): Promise<string> {
  // 001BK is disabled/inaccessible; its winners were cloned into BK COM
  // (act_1232344655348024), which the meta_connections token CAN read. The dead
  // META_ACCESS_TOKEN (code 190) is intentionally not used.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", WORKSPACE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`No meta_connections: ${error?.message}`);
  return decrypt(data.access_token);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphGet(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) {
    const err = data.error;
    if (err.code === 17 || err.code === 4 || err.code === 32) {
      console.log("  ...rate limited, 30s");
      await sleep(30000);
      return graphGet(path, token);
    }
    throw new Error(`Graph: ${err.message} (code ${err.code})`);
  }
  return data;
}

function getAction(actions: any[], types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return parseFloat(a.value) || 0;
  }
  return 0;
}

(async () => {
  const token = await getToken();
  console.log(`Lendo insights de ${SRC_ACCOUNT} (lifetime)...\n`);

  // Campaign-level lifetime insights
  let rows: any[] = [];
  try {
    let url =
      `/${SRC_ACCOUNT}/insights?level=campaign&date_preset=maximum&limit=200` +
      `&fields=campaign_id,campaign_name,spend,purchase_roas,actions,action_values,impressions,clicks,ctr`;
    while (url) {
      const page = await graphGet(url, token);
      rows.push(...(page.data || []));
      url = page.paging?.next ? page.paging.next.replace(BASE, "") : "";
    }
  } catch (e: any) {
    console.error("Falha ao ler insights (conta pode estar desabilitada):", e.message);
    process.exit(1);
  }

  const enriched = rows.map((r) => {
    const spend = parseFloat(r.spend) || 0;
    const roas = getAction(r.purchase_roas, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const purchases = getAction(r.actions, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    const revenue = getAction(r.action_values, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
    return {
      id: r.campaign_id,
      name: r.campaign_name,
      spend,
      roas,
      purchases,
      revenue,
      impressions: parseInt(r.impressions) || 0,
      ctr: parseFloat(r.ctr) || 0,
    };
  });

  const qualified = enriched.filter((c) => c.spend >= MIN_SPEND);
  const top = [...qualified].sort((a, b) => b.roas - a.roas).slice(0, TOP_N);

  console.log(`Campanhas totais: ${enriched.length} | com gasto >= R$${MIN_SPEND}: ${qualified.length}\n`);
  console.log(`===== TOP ${top.length} por ROAS (lifetime, gasto >= R$${MIN_SPEND}) =====`);
  for (const c of top) {
    console.log(
      `\n• ${c.name}\n  ROAS ${c.roas.toFixed(2)}x | gasto R$ ${c.spend.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} | ` +
      `receita R$ ${c.revenue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} | ${Math.round(c.purchases)} compras | CTR ${c.ctr.toFixed(2)}%`
    );
  }

  // Inspect creatives of the top campaigns
  console.log(`\n\n===== Criativos dos top campaigns (vídeo vs imagem + fontes p/ TikTok) =====`);
  for (const c of top.slice(0, 6)) {
    try {
      const ads = await graphGet(
        `/${c.id}/ads?limit=50&fields=name,effective_status,creative{id,video_id,object_type,thumbnail_url,effective_object_story_id}`,
        token
      );
      const list = ads.data || [];
      let video = 0, image = 0, other = 0;
      const videoIds: string[] = [];
      for (const ad of list) {
        const cr = ad.creative || {};
        if (cr.video_id) { video++; videoIds.push(cr.video_id); }
        else if (cr.object_type === "PHOTO" || cr.object_type === "SHARE") image++;
        else other++;
      }
      console.log(
        `\n• ${c.name}: ${list.length} ads → ${video} vídeo / ${image} imagem / ${other} outros`
      );
      // Probe one video source (downloadable URL = creative bridge feasible)
      if (videoIds.length) {
        try {
          const v = await graphGet(`/${videoIds[0]}?fields=source,picture,length`, token);
          console.log(`  vídeo exemplo ${videoIds[0]}: source ${v.source ? "✅ baixável" : "❌"} ${v.length ? `(${v.length}s)` : ""}`);
        } catch (e: any) {
          console.log(`  vídeo source: ❌ ${e.message}`);
        }
      }
    } catch (e: any) {
      console.log(`\n• ${c.name}: erro lendo ads — ${e.message}`);
    }
  }

  console.log("\n\nFim da análise.");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
