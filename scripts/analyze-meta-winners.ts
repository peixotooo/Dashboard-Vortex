/**
 * READ-ONLY: ranqueia as melhores campanhas Meta (últimos 30d) nas contas acessíveis,
 * pra decidir o que replicar (ângulo/criativo) no TikTok.
 * Usage: npx tsx scripts/analyze-meta-winners.ts [date_preset]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const BASE = "https://graph.facebook.com/v23.0";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const PRESET = process.argv[2] || "last_30d";
const MIN_SPEND = Number(process.env.MIN_SPEND || 200);

async function token(): Promise<string> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("meta_connections").select("access_token").eq("workspace_id", WS).order("created_at", { ascending: false }).limit(1).single();
  return decrypt(data!.access_token);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function g(path: string, t: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${t}`);
  const d = await res.json();
  if (d.error) { if ([17, 4, 32].includes(d.error.code)) { await sleep(20000); return g(path, t); } throw new Error(d.error.message); }
  return d;
}
const act = (arr: any[], types: string[]) => { if (!Array.isArray(arr)) return 0; for (const t of types) { const a = arr.find((x) => x.action_type === t); if (a) return parseFloat(a.value) || 0; } return 0; };
const PURCH = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

(async () => {
  const t = await token();
  const accounts = await g("/me/adaccounts?fields=account_id,name,account_status&limit=100", t);
  const active = (accounts.data || []).filter((a: any) => a.account_status === 1);
  console.log(`Contas ativas: ${active.map((a: any) => a.name).join(", ")}\n`);

  const all: any[] = [];
  for (const acc of active) {
    try {
      let url = `/act_${acc.account_id}/insights?level=campaign&date_preset=${PRESET}&limit=200&fields=campaign_id,campaign_name,spend,purchase_roas,actions,action_values,impressions,ctr`;
      while (url) {
        const page = await g(url, t);
        for (const r of page.data || []) {
          const spend = parseFloat(r.spend) || 0;
          if (spend < MIN_SPEND) continue;
          all.push({ acc: acc.name, accId: acc.account_id, id: r.campaign_id, name: r.campaign_name, spend,
            roas: act(r.purchase_roas, PURCH), purchases: act(r.actions, PURCH), revenue: act(r.action_values, PURCH), ctr: parseFloat(r.ctr) || 0 });
        }
        url = page.paging?.next ? page.paging.next.replace(BASE, "") : "";
      }
    } catch (e: any) { console.log(`(${acc.name}: ${e.message})`); }
  }

  const winners = all.filter((c) => c.purchases >= 1).sort((a, b) => b.roas - a.roas).slice(0, 15);
  console.log(`=== MELHORES CAMPANHAS META (${PRESET}, gasto >= R$${MIN_SPEND}, >=1 compra) ===`);
  for (const c of winners) {
    console.log(`\n• [${c.acc}] ${c.name}`);
    console.log(`  ROAS ${c.roas.toFixed(2)}x | gasto R$ ${Math.round(c.spend).toLocaleString("pt-BR")} | ${Math.round(c.purchases)} compras | receita R$ ${Math.round(c.revenue).toLocaleString("pt-BR")} | CTR ${c.ctr.toFixed(2)}%`);
  }

  // Destaque THE SALE / campanhas com "sale" no nome (mesmo abaixo do piso de gasto)
  const sale = all.filter((c) => /sale|promo|liquid|outlet/i.test(c.name)).sort((a, b) => b.revenue - a.revenue);
  console.log(`\n=== CAMPANHAS "SALE/PROMO" (qualquer gasto) ===`);
  if (!sale.length) console.log("(nenhuma encontrada nesta janela)");
  for (const c of sale) console.log(`• [${c.acc}] ${c.name}: ROAS ${c.roas.toFixed(2)}x | gasto R$ ${Math.round(c.spend).toLocaleString("pt-BR")} | ${Math.round(c.purchases)} compras | receita R$ ${Math.round(c.revenue).toLocaleString("pt-BR")} | CTR ${c.ctr.toFixed(2)}%`);

  // ângulo/criativo das top 6
  console.log(`\n\n=== ÂNGULO/CRIATIVO das top 6 ===`);
  for (const c of winners.slice(0, 6)) {
    try {
      const ads = await g(`/${c.id}/ads?limit=8&fields=name,creative{video_id,object_type,body,title}`, t);
      const list = ads.data || [];
      const vids = list.filter((a: any) => a.creative?.video_id).length;
      const sample = list[0]?.creative || {};
      console.log(`\n• [${c.acc}] ${c.name}: ${list.length} ads (${vids} vídeo)`);
      if (sample.body) console.log(`  copy: "${String(sample.body).replace(/\s+/g, " ").slice(0, 110)}"`);
      if (sample.title) console.log(`  título: "${String(sample.title).slice(0, 70)}"`);
    } catch (e: any) { console.log(`  (erro lendo ads: ${e.message})`); }
  }
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
