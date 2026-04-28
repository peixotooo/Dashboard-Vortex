/**
 * In-place hotfix for the live Smart Rotation Tier C bucket (discount 212):
 *   1. PATCH /discounts/212 { cumulative: true }
 *   2. For every still-active coupon in the bucket, replace the existing
 *      "fixed BRL" rule with a "percentage" rule using row.discount_pct.
 *      DELETE old rule → POST new rule → UPDATE promo_active_coupons.vnda_rule_id.
 *
 * Plus: turn on cumulative_with_other_promos in coupon_settings so
 * future buckets respect the new behavior.
 *
 * The paused coupon (FLASH142010DBTK pid=1420) had its rule already removed
 * earlier and stays paused — we skip it.
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

  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, api_token, store_host")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;
  const token = decrypt(conn!.api_token as string);
  const host = conn!.store_host as string;
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Shop-Host": host,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Step 1: turn on workspace-level cumulative
  console.log("Step 1: coupon_settings.cumulative_with_other_promos = true");
  const { error: setErr } = await db
    .from("coupon_settings")
    .update({ cumulative_with_other_promos: true, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);
  console.log(setErr ? `  ❌ ${setErr.message}` : "  ✅");

  // Step 2: discount 212 cumulative true
  console.log(`\nStep 2: PATCH /discounts/${PROMO} { cumulative: true }`);
  const r1 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ cumulative: true }),
  });
  console.log(`  HTTP ${r1.status}`);

  // Step 3: replace each rule
  const { data: rows } = await db
    .from("promo_active_coupons")
    .select("id, vnda_coupon_code, product_id, vnda_rule_id, discount_pct")
    .eq("vnda_discount_id", PROMO)
    .eq("status", "active");
  console.log(`\nStep 3: replacing ${rows?.length || 0} rules with pct rules`);

  for (const row of rows || []) {
    const oldRuleId = row.vnda_rule_id as number | null;
    const productId = Number(row.product_id);
    const pct = Number(row.discount_pct);
    console.log(`  ${row.vnda_coupon_code} pid=${productId} pct=${pct}%`);

    // DELETE old rule (if it exists in DB)
    if (oldRuleId) {
      const del = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}/rules/${oldRuleId}`, {
        method: "DELETE",
        headers,
      });
      console.log(`    DELETE rule ${oldRuleId} → HTTP ${del.status}`);
    }

    // POST new rule with amount_type: "%"
    const post = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}/rules/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: productId,
        apply_to: "product",
        amount_type: "%",
        amount: pct,
      }),
    });
    if (!post.ok) {
      console.log(`    ❌ POST rule HTTP ${post.status} ${(await post.text()).slice(0, 200)}`);
      continue;
    }
    const newRule = (await post.json()) as { id: number };
    console.log(`    POST new rule id=${newRule.id} amount=${pct}%`);

    // Update DB
    await db
      .from("promo_active_coupons")
      .update({ vnda_rule_id: newRule.id, discount_unit: "pct", updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // Step 4: confirm final state
  const r4 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}/rules/`, { headers });
  const finalRules = (await r4.json()) as Array<{ id: number; product?: { id: number; name: string }; amount: number; type: string }>;
  console.log(`\n${finalRules.length} rules ativas no discount ${PROMO} agora:`);
  for (const r of finalRules) console.log(`  rule=${r.id} pid=${r.product?.id} ${r.product?.name?.slice(0, 40)} ${r.type}=${r.amount}`);

  const r5 = await fetch(`https://api.vnda.com.br/api/v2/discounts/${PROMO}`, { headers });
  const d = await r5.json();
  console.log(`\ndiscount ${PROMO}: enabled=${d.enabled} · cumulative=${d.cumulative}`);
}
main();
