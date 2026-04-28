import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const COUPON = "FLASH136710ONK6";

  // Search crm_vendas for any prior order that used this coupon
  const { data: vendas } = await db
    .from("crm_vendas")
    .select("email, cliente, data_compra, valor, cupom, source")
    .ilike("cupom", `%${COUPON}%`)
    .limit(5);
  console.log(`crm_vendas com cupom "${COUPON}": ${vendas?.length || 0}`);
  for (const v of vendas || []) {
    console.log(`  ${v.data_compra} · ${v.email} · R$${v.valor} · cupom=${v.cupom} · source=${v.source}`);
  }

  // Also check the prefix FLASH13... pra ver se é formato de uma campanha conhecida
  const { data: prefix } = await db
    .from("crm_vendas")
    .select("cupom")
    .ilike("cupom", "FLASH%")
    .limit(20);
  const cupons = new Set((prefix || []).map((r) => r.cupom));
  console.log(`\nCupons com prefixo FLASH em crm_vendas (sample):`);
  for (const c of cupons) console.log(`  ${c}`);

  // Check cashback_transactions — our new system never uses coupons but just in case
  const { data: cb } = await db
    .from("cashback_transactions")
    .select("id")
    .ilike("source_order_id", `%${COUPON}%`)
    .limit(5);
  console.log(`\ncashback_transactions com referência a "${COUPON}": ${cb?.length || 0}`);
}
main();
