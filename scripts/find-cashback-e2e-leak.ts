/**
 * Identifies any cashback_transactions that were silently flipped to ATIVO
 * during today's E2E test window (deposited_em within the last 10 minutes),
 * excluding the synthetic probes we already cleaned up.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

async function main() {
  const { data } = await db
    .from("cashback_transactions")
    .select("id, workspace_id, source_order_id, numero_pedido, email, valor_cashback, status, depositado_em, updated_at, confirmado_em")
    .gte("depositado_em", since)
    .order("depositado_em", { ascending: true });

  console.log(`\nTransações com depositado_em >= ${since}:`);
  for (const r of data || []) {
    console.log(JSON.stringify(r, null, 2));
  }
  console.log(`\nTotal: ${data?.length ?? 0}`);

  // Match by source_order_id NOT starting with our test prefix
  const realOnes = (data || []).filter((r) => !String(r.source_order_id).startsWith("9000"));
  console.log(`\nTransações reais (não-teste): ${realOnes.length}`);
  for (const r of realOnes) {
    console.log(`  - id=${r.id} pedido=${r.numero_pedido || r.source_order_id} email=${r.email} valor=${r.valor_cashback}`);
  }
}
main();
