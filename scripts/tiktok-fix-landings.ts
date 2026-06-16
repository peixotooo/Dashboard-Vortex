/**
 * Reaponta o destino (landing) de cada anúncio pro produto/coleção certo + UTMs.
 * Edição ad-level (NÃO reseta o aprendizado do ad group). Dry-run por padrão; --confirm aplica.
 * Usage: npx tsx scripts/tiktok-fix-landings.ts [--confirm]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADV = "7246116612330242049";
const ADGROUP = "1867660835334353";
const CONFIRM = process.argv.includes("--confirm");

// nome do anúncio -> landing base (UTMs adicionados depois)
const MAP: Record<string, string> = {
  "IG Winner 1": "https://www.bulking.com.br/mais-vendidos",
  "IG Winner 2": "https://www.bulking.com.br/lancamentos",
  "IG Winner 3": "https://www.bulking.com.br/combos",
  "IG Winner 4": "https://www.bulking.com.br/busca?q=luxury%20heritage",
  "IG Winner 5": "https://www.bulking.com.br/busca?q=luxury%20heritage",
};

function withUtm(url: string, content: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=tiktok&utm_medium=paid&utm_campaign=ig-winners&utm_content=${content}`;
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  const token = decrypt(data!.access_token);
  const call = async (p: string, params: any, method = "GET") => {
    let url = `${API}${p}`; const init: any = { method, headers: { "Access-Token": token, "Content-Type": "application/json" } };
    if (method === "GET") { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); url += `?${qs}`; }
    else init.body = JSON.stringify(params);
    return (await fetch(url, init)).json();
  };

  // lê criativos atuais
  const got = await call("/ad/get/", { advertiser_id: ADV, filtering: { adgroup_ids: [ADGROUP] }, fields: ["ad_id", "ad_name", "identity_id", "identity_type", "ad_format", "video_id", "image_ids", "ad_text", "call_to_action", "landing_page_url"] });
  const ads = got.data?.list || [];
  console.log(`${ads.length} anúncios no grupo.\n`);

  for (const ad of ads) {
    const base = MAP[ad.ad_name];
    if (!base) { console.log(`• ${ad.ad_name}: sem mapeamento — pulando`); continue; }
    const newUrl = withUtm(base, ad.ad_name.replace(/\s+/g, "").toLowerCase());
    console.log(`• ${ad.ad_name}\n    de:  ${ad.landing_page_url}\n    pra: ${newUrl}`);
    if (!CONFIRM) continue;
    const r = await call("/ad/update/", {
      advertiser_id: ADV,
      adgroup_id: ADGROUP,
      creatives: [{
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        identity_id: ad.identity_id,
        identity_type: ad.identity_type,
        ad_format: ad.ad_format,
        video_id: ad.video_id,
        image_ids: ad.image_ids,
        ad_text: ad.ad_text,
        call_to_action: ad.call_to_action,
        landing_page_url: newUrl,
      }],
    }, "POST");
    console.log(r.code === 0 ? `    ✅ atualizado (volta pra revisão)` : `    ❌ ${r.code}: ${r.message}`);
  }
  if (!CONFIRM) console.log(`\n[DRY-RUN] Nada alterado. Rode com --confirm pra aplicar.`);
})().catch((e) => console.error("ERRO:", e.message));
