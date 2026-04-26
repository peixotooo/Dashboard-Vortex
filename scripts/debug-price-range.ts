// Quantos produtos active+in_stock tem preco efetivo <= 79?
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id").ilike("name", "%bulking%").limit(1).single();

  const PAGE = 1000;
  let from = 0;
  let total = 0;
  let underHits: Array<{ id: string; name: string; eff: number }> = [];
  while (true) {
    const { data } = await admin
      .from("shelf_products")
      .select("product_id, name, price, sale_price")
      .eq("workspace_id", ws!.id)
      .eq("active", true)
      .eq("in_stock", true)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const p of data) {
      total++;
      const eff = (p.sale_price && p.sale_price > 0) ? p.sale_price : p.price;
      if (typeof eff === "number" && eff > 0 && eff <= 79) {
        underHits.push({ id: p.product_id, name: p.name, eff });
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total active+in_stock: ${total}`);
  console.log(`Com preco efetivo <= R$ 79: ${underHits.length}`);
  underHits.sort((a, b) => a.eff - b.eff);
  console.log("Top 15 mais baratos:");
  underHits.slice(0, 15).forEach((p) => console.log(`  R$ ${p.eff.toFixed(2)} - ${p.id} ${p.name}`));
}

main().catch(e => { console.error(e); process.exit(1); });
