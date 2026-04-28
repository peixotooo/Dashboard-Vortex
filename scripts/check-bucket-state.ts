import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // All coupons sharing the SAME vnda_discount_id (=212)
  const { data } = await db
    .from("promo_active_coupons")
    .select("vnda_coupon_code, status, status_reason, product_id, expires_at, vnda_discount_id, created_at")
    .eq("vnda_discount_id", 212)
    .order("created_at", { ascending: true });
  console.log(`\n${data?.length || 0} cupons no discount 212 (bucket):`);
  for (const c of data || []) console.log(`  ${c.vnda_coupon_code.padEnd(20)} pid=${c.product_id} · status=${c.status} reason=${c.status_reason || "-"} expires=${c.expires_at}`);

  // Audit log for discount 212
  console.log(`\n=== Audit log relevante (últimos 30 dias) ===`);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const { data: audit } = await db
    .from("coupon_audit_log")
    .select("action, actor, error_message, details, created_at")
    .gte("created_at", since.toISOString())
    .or("details->>promotion_id.eq.212,action.like.%pause%,action.like.%expire%")
    .order("created_at", { ascending: false })
    .limit(20);
  for (const a of audit || []) console.log(`  ${a.created_at} · ${a.action} · actor=${a.actor || "-"} · err=${a.error_message || "-"} · details=${JSON.stringify(a.details).slice(0, 200)}`);
}
main();
