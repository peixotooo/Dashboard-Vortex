import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const ENC = process.env.ENCRYPTION_KEY!;
function decrypt(t: string): string {
  if (!t.includes(":")) return t;
  const [iv, tag, enc] = t.split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(ENC, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}

async function main() {
  const PROMO_ID = 212;
  const RULE_ID = 720;
  const PRODUCT_ID = 1367;

  const { data: conn } = await db.from("vnda_connections").select("api_token, store_host").eq("enable_cashback", true).limit(1).single();
  const token = decrypt(conn!.api_token as string);
  const host = conn!.store_host as string;
  const headers = { Authorization: `Bearer ${token}`, "X-Shop-Host": host, Accept: "application/json" };

  console.log(`\n=== Discount ${PROMO_ID} ===`);
  const d = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO_ID}`, { headers });
  console.log(`HTTP ${d.status}`);
  console.log(JSON.stringify(await d.json().catch(() => null), null, 2));

  console.log(`\n=== Rules of discount ${PROMO_ID} ===`);
  const r = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO_ID}/rules/`, { headers });
  console.log(`HTTP ${r.status}`);
  console.log(JSON.stringify(await r.json().catch(() => null), null, 2));

  console.log(`\n=== Coupons of discount ${PROMO_ID} ===`);
  const c = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO_ID}/coupons/`, { headers });
  console.log(`HTTP ${c.status}`);
  console.log(JSON.stringify(await c.json().catch(() => null), null, 2));

  console.log(`\n=== Product ${PRODUCT_ID} (rule target) ===`);
  const p = await fetch(`https://api.vnda.com.br/api/v2/products/${PRODUCT_ID}`, { headers });
  console.log(`HTTP ${p.status}`);
  const pj = await p.json().catch(() => null);
  if (pj) {
    console.log(`name: ${pj.name} · slug: ${pj.slug} · reference: ${pj.reference} · active: ${pj.active} · available: ${pj.available}`);
  }

  console.log(`\n=== Product na URL atual (CAMISETA FIT OFF) ===`);
  const search = await fetch(`https://api.vnda.com.br/api/v2/products?per_page=5&q=fit+off`, { headers });
  const sj = await search.json().catch(() => null);
  if (sj) {
    const arr = Array.isArray(sj) ? sj : sj.products || sj.data || [];
    for (const item of arr.slice(0, 5)) {
      console.log(`  id=${item.id} · name=${item.name} · slug=${item.slug}`);
    }
  }
}
main();
