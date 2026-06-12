/** READ-ONLY: lista pixels da BULKING 2.0 usando o token persistido (mapeia code→pixel_id). */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";
config({ path: ".env.local" });

const API = "https://business-api.tiktok.com/open_api/v1.3";
const WS = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
const ADVERTISER = "7246116612330242049";

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tiktok_credentials").select("access_token").eq("workspace_id", WS).single();
  if (!data) throw new Error("sem token persistido");
  const token = decrypt(data.access_token);

  for (const path of ["/pixel/list/", "/pixel/list/"]) {
    const url = `${API}${path}?advertiser_id=${ADVERTISER}&page_size=50`;
    const j = await (await fetch(url, { headers: { "Access-Token": token } })).json();
    if (j.code !== 0) { console.log(`${path} → ❌ code ${j.code}: ${j.message}`); break; }
    const list = j.data?.pixels || j.data?.list || [];
    console.log(`Pixels: ${list.length}`);
    for (const p of list) {
      console.log(`  • pixel_id ${p.pixel_id}  | code ${p.pixel_code}  | ${p.pixel_name || ""}`);
    }
    break;
  }
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
