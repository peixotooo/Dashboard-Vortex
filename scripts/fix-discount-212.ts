/**
 * 1. Reactivates discount 212 on VNDA (enabled=true) so the 9 active coupons
 *    in the Smart Rotation Tier C bucket work again.
 * 2. Removes the rule that ties pid=1420 to the discount — so coupon
 *    FLASH142010DBTK becomes ineffective (no matching product rule) WITHOUT
 *    affecting the other 9 products.
 *
 * Authorized by user.
 */
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
  const PROMO = 212;
  const PAUSED_PID = 1420;
  const PAUSED_COUPON = "FLASH142010DBTK";

  const { data: conn } = await db.from("vnda_connections").select("api_token, store_host").eq("enable_cashback", true).limit(1).single();
  const token = decrypt(conn!.api_token as string);
  const host = conn!.store_host as string;
  const headers = { Authorization: `Bearer ${token}`, "X-Shop-Host": host, Accept: "application/json", "Content-Type": "application/json" };

  // Step 1: reactivate discount 212
  console.log(`Step 1: PATCH /discounts/${PROMO} { enabled: true }`);
  const r1 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true }),
  });
  console.log(`  HTTP ${r1.status}`);
  if (!r1.ok) {
    console.log(await r1.text());
    process.exit(1);
  }

  // Confirm
  const r2 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}`, { headers });
  const d = await r2.json();
  console.log(`  enabled=${d.enabled}`);

  // Step 2: find rule_id for pid=1420 in DB (we stored it on creation)
  const { data: row } = await db
    .from("promo_active_coupons")
    .select("vnda_rule_id, vnda_coupon_code")
    .eq("vnda_coupon_code", PAUSED_COUPON)
    .single();
  const ruleId = row?.vnda_rule_id;
  console.log(`\nStep 2: cupom ${PAUSED_COUPON} → rule_id=${ruleId}`);

  if (!ruleId) {
    console.log("  ⚠️ rule_id não encontrado, skipando remoção da rule");
  } else {
    const r3 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}/rules/${ruleId}`, {
      method: "DELETE",
      headers,
    });
    console.log(`  DELETE /discounts/${PROMO}/rules/${ruleId} → HTTP ${r3.status}`);
    if (r3.status >= 400 && r3.status !== 404) {
      console.log(await r3.text());
    }
  }

  // Step 3: confirm bucket state
  const r4 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}/rules/`, { headers });
  const rules = (await r4.json()) as Array<{ id: number; product?: { id: number; name: string }; amount: number; type: string }>;
  console.log(`\n${rules.length} rules ativas no discount ${PROMO} agora:`);
  for (const r of rules) console.log(`  rule=${r.id} pid=${r.product?.id} ${r.product?.name} ${r.type}=${r.amount}`);

  console.log(`\n✅ Discount reativado · ${rules.length}/10 produtos com rule ativa`);
}
main();
