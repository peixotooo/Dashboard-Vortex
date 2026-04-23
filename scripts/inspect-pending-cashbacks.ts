import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data } = await db
    .from("cashback_transactions")
    .select("id, source_order_id, numero_pedido, email, nome_cliente, valor_pedido, valor_cashback, confirmado_em, expira_em, status, reativado")
    .eq("status", "AGUARDANDO_DEPOSITO")
    .order("confirmado_em", { ascending: true });

  console.log(`\n${data?.length || 0} cashbacks AGUARDANDO_DEPOSITO:\n`);
  const now = Date.now();
  for (const r of data || []) {
    const confirmado = new Date(r.confirmado_em as string);
    const daysSince = Math.floor((now - confirmado.getTime()) / (24 * 3600 * 1000));
    const daysUntilDeposit = 15 - daysSince;
    console.log(`  pedido ${r.numero_pedido || r.source_order_id}`);
    console.log(`    cliente: ${r.nome_cliente || "?"} <${r.email}>`);
    console.log(`    pedido=R$${r.valor_pedido} · cashback=R$${r.valor_cashback}`);
    console.log(`    confirmado=${new Date(r.confirmado_em as string).toLocaleDateString("pt-BR")} (${daysSince}d atrás)`);
    console.log(`    depósito previsto: ${daysUntilDeposit >= 0 ? `em ${daysUntilDeposit}d` : `${Math.abs(daysUntilDeposit)}d ATRASADO`}`);
    console.log(`    expira em: ${new Date(r.expira_em as string).toLocaleDateString("pt-BR")}`);
    console.log("");
  }

  // Also check for any pending eligible for deposit RIGHT NOW (D+15 reached)
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 15);
  const { data: dueNow } = await db
    .from("cashback_transactions")
    .select("id, source_order_id, email, valor_cashback, confirmado_em")
    .eq("status", "AGUARDANDO_DEPOSITO")
    .lte("confirmado_em", cutoff.toISOString());
  console.log(`\n→ Prontos pra depositar HOJE (confirmado <= ${cutoff.toISOString().slice(0, 10)}):`);
  if (dueNow && dueNow.length > 0) {
    for (const r of dueNow) console.log(`  ⚠️  ${r.source_order_id} · ${r.email} · R$${r.valor_cashback}`);
  } else {
    console.log(`  (nenhum) — próximo depósito só quando algum confirmado_em antigo bater 15d`);
  }
}
main();
