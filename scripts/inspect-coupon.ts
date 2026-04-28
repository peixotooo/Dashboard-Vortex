import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const COUPON = "FLASH136710ONK6";
  const { data, error } = await db
    .from("promo_active_coupons")
    .select("*")
    .eq("vnda_coupon_code", COUPON)
    .maybeSingle();
  if (error) console.log("query error:", error);
  if (!data) {
    console.log(`Cupom "${COUPON}" não encontrado em promo_active_coupons.`);
    // Try LIKE
    const { data: like } = await db
      .from("promo_active_coupons")
      .select("vnda_coupon_code, status, expires_at, vnda_discount_id, product_id, created_at")
      .ilike("vnda_coupon_code", `FLASH%1367%`)
      .order("created_at", { ascending: false })
      .limit(10);
    console.log(`\nCupons com pid 1367 (sample):`);
    for (const c of like || []) console.log(`  ${c.vnda_coupon_code} · ${c.status} · expires=${c.expires_at} · pid=${c.product_id}`);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}
main();
