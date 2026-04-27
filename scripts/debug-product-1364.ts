// Por que o produto 1364 (BERMUDA OMNIA OFF) nao recebe o badge de viewers?
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";
import { computePromoTagMatches } from "../src/lib/promo-tags/matcher";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace nao encontrado");

  const PID = "1364";

  // 1. Existe no shelf_products?
  const { data: p } = await admin
    .from("shelf_products")
    .select("product_id, name, active, in_stock, price, sale_price, tags")
    .eq("workspace_id", ws.id)
    .eq("product_id", PID)
    .maybeSingle();
  console.log("=== shelf_products ===");
  if (!p) {
    console.log(`Produto ${PID} NAO esta em shelf_products!`);
  } else {
    console.log(`product_id=${p.product_id} active=${p.active} in_stock=${p.in_stock}`);
    console.log(`name: ${p.name}`);
    console.log(`price=${p.price} sale_price=${p.sale_price}`);
    const arr = (p.tags as { vnda_tags?: Array<{ name?: string } | string> })?.vnda_tags
      || (Array.isArray(p.tags) ? (p.tags as Array<{ name?: string } | string>) : []);
    const names = (Array.isArray(arr) ? arr : []).map(t => typeof t === "string" ? t : t?.name).filter(Boolean);
    console.log(`tags (${names.length}): ${names.join(", ")}`);
    console.log(`tem "todos"? ${names.includes("todos") ? "SIM" : "NAO"}`);
  }

  // 2. Quais regras estao habilitadas?
  console.log("\n=== Regras habilitadas ===");
  const { data: rules } = await admin
    .from("promo_tag_configs")
    .select("id, name, enabled, badge_type, match_type, match_value, badge_text, viewers_min, viewers_max")
    .eq("workspace_id", ws.id)
    .eq("enabled", true)
    .order("priority", { ascending: false });
  for (const r of rules || []) {
    console.log(`  type=${r.badge_type || "static"} match=${r.match_type}:"${r.match_value}" → "${r.badge_text}"  (viewers: ${r.viewers_min}-${r.viewers_max})`);
  }

  // 3. Roda matcher e ve o que sai pra esse produto
  console.log("\n=== computePromoTagMatches() ===");
  const payload = await computePromoTagMatches(ws.id);
  const m = payload.matches[PID];
  if (!m) {
    console.log(`Produto ${PID}: SEM MATCH`);
  } else {
    console.log(`Produto ${PID}: ${m.length} match(es)`);
    for (const r of m) {
      console.log(`  type=${r.badge_type} text="${r.badge_text}" baseline=${r.viewers_baseline ?? "-"} cashback=${r.cashback_value ?? "-"}`);
    }
  }
  console.log(`\ntotal de produtos com algum match: ${Object.keys(payload.matches).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
