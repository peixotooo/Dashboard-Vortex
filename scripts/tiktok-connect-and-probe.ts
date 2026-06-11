/**
 * Conecta o TikTok (troca auth_code por token DURÁVEL), PERSISTE em tiktok_credentials
 * e sonda os pré-requisitos de Ads (identity + pixel) por advertiser. Depois disso,
 * os demais scripts leem o token do banco — sem precisar de novo auth_code.
 *
 * Usage:
 *   TIKTOK_APP_ID=... TIKTOK_APP_SECRET=... TIKTOK_AUTH_CODE=... \
 *     npx tsx scripts/tiktok-connect-and-probe.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const APP_ID = process.env.TIKTOK_APP_ID!;
const SECRET = process.env.TIKTOK_APP_SECRET!;
const AUTH = process.env.TIKTOK_AUTH_CODE!;
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
if (!APP_ID || !SECRET || !AUTH) { console.error("Faltam TIKTOK_APP_ID/SECRET/AUTH_CODE"); process.exit(1); }

async function tt(path: string, opts: { token?: string; params?: any; method?: string } = {}) {
  const method = opts.method || "GET";
  let url = `${API}${path}`;
  const init: any = { method, headers: { "Content-Type": "application/json" } };
  if (opts.token) init.headers["Access-Token"] = opts.token;
  if (method === "GET" && opts.params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.params)) {
      if (v == null) continue;
      qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    url += `?${qs}`;
  } else if (opts.params) init.body = JSON.stringify(opts.params);
  return (await fetch(url, init)).json();
}

(async () => {
  const tok = await tt("/oauth2/access_token/", { method: "POST", params: { app_id: APP_ID, secret: SECRET, auth_code: AUTH, grant_type: "auth_code" } });
  if (tok.code !== 0) { console.error("Token falhou:", tok.code, tok.message); process.exit(1); }
  const token: string = tok.data.access_token;
  const advs: string[] = (tok.data.advertiser_ids || []).map(String);
  const scope: number[] = (tok.data.scope || []).map(Number).filter(Number.isFinite);
  console.log(`Token OK. Advertisers: ${advs.length}`);

  // Persiste token durável (a feature: o callback OAuth faz isso; aqui fazemos no manual)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await sb.from("tiktok_credentials").upsert(
    { workspace_id: WS, access_token: encrypt(token), advertiser_ids: advs, scope, tiktok_app_id: APP_ID, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id" }
  );
  console.log(error ? `⚠️ persistência falhou: ${error.message}` : `✅ token persistido em tiktok_credentials (ws ${WS.slice(0,8)})`);

  // Sonda pré-requisitos de Ads
  for (const adv of advs) {
    console.log(`\n================ Advertiser ${adv} ================`);
    const idn = await tt("/identity/get/", { token, params: { advertiser_id: adv } });
    if (idn.code === 0) {
      const list = idn.data?.identity_list || [];
      console.log(`Identities (pra publicar anúncio): ${list.length}`);
      for (const i of list) console.log(`  • ${i.identity_type} ${i.identity_id} — ${i.display_name || ""}`);
    } else console.log(`Identities: ❌ code ${idn.code} ${idn.message}`);

    const px = await tt("/pixel/list/", { token, params: { advertiser_id: adv } });
    if (px.code === 0) {
      const list = px.data?.pixels || px.data?.list || [];
      console.log(`Pixels (pra WEB_CONVERSIONS): ${list.length}`);
      for (const p of list) {
        const events = (p.events || p.pixel_events || []).map((e: any) => e.event_type || e.type).filter(Boolean);
        console.log(`  • ${p.pixel_id || p.pixel_code} — ${p.pixel_name || ""} ${events.length ? "[" + events.join(",") + "]" : ""}`);
      }
    } else console.log(`Pixels: ❌ code ${px.code} ${px.message}`);
  }

  console.log("\nVeredito p/ Caminho Ads (WEB_CONVERSIONS):");
  console.log("- Advertiser com identity + pixel(com purchase/complete_payment) = pronto pra criar campanha.");
  console.log("- Sem identity → criar/conectar identity antes. Sem pixel → instalar pixel no site VNDA antes.");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
