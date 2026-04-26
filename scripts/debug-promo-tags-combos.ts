// Debug: por que o produto camiseta-oversized-destruction-preta-1290
// nao recebe a promo tag "combos"?
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";

async function main() {
  const admin = createAdminClient();

  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name")
    .ilike("name", "%bulking%")
    .limit(1)
    .single();
  if (!ws) throw new Error("workspace nao encontrado");
  console.log("Workspace:", ws.id, ws.name);

  // 1. Conta total de shelf_products
  const { count: total } = await admin
    .from("shelf_products")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws.id)
    .eq("active", true)
    .eq("in_stock", true);
  console.log(`\nTotal de shelf_products active+in_stock: ${total}`);

  // 2. Pega o produto especifico (slug ou nome)
  const { data: target } = await admin
    .from("shelf_products")
    .select("product_id, name, tags, category, active, in_stock")
    .eq("workspace_id", ws.id)
    .or("name.ilike.%destruction%preta%,product_id.eq.1290")
    .limit(5);
  console.log("\nProdutos encontrados:");
  for (const p of target || []) {
    console.log(`  product_id=${p.product_id} active=${p.active} in_stock=${p.in_stock} name=${p.name}`);
    console.log(`    tags=`, JSON.stringify(p.tags).slice(0, 300));
  }

  // 3. Pega regras de promo_tag combos
  const { data: rules } = await admin
    .from("promo_tag_configs")
    .select("*")
    .eq("workspace_id", ws.id)
    .eq("enabled", true)
    .ilike("match_value", "combos")
    .order("priority", { ascending: false });
  console.log("\nRegras 'combos':");
  for (const r of rules || []) {
    console.log(`  id=${r.id} match_type=${r.match_type} match_value="${r.match_value}" badge="${r.badge_text}" priority=${r.priority}`);
  }

  // 4. Quantos produtos tem a tag combos? Paginando manualmente
  const PAGE = 1000;
  let from = 0;
  let totalScanned = 0;
  const withCombos: Array<{ product_id: string; name: string }> = [];
  while (true) {
    const { data: page } = await admin
      .from("shelf_products")
      .select("product_id, name, tags")
      .eq("workspace_id", ws.id)
      .eq("active", true)
      .eq("in_stock", true)
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    totalScanned += page.length;
    for (const p of page) {
      const tags = p.tags as { vnda_tags?: Array<{ name?: string }> } | null;
      const arr = tags?.vnda_tags || [];
      const has = Array.isArray(arr) && arr.some((t) => (t?.name || "").toLowerCase().trim() === "combos");
      if (has) withCombos.push({ product_id: p.product_id, name: p.name });
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\nTotal scanned: ${totalScanned}`);
  console.log(`Produtos com tag "combos": ${withCombos.length}`);
  console.log(`Primeiros 10:`);
  withCombos.slice(0, 10).forEach((p) => console.log(`  ${p.product_id} - ${p.name}`));

  // 5. Especificamente: nosso produto target esta no withCombos?
  const targetIds = (target || []).map((t) => t.product_id);
  const targetHits = withCombos.filter((p) => targetIds.includes(p.product_id));
  console.log(`\nProduto(s) target estao no resultado de combos? ${targetHits.length > 0 ? "SIM" : "NAO"}`);
  for (const t of targetHits) console.log(`  hit: ${t.product_id} - ${t.name}`);

  // 6. Re-roda o matcher e mede quantos product_ids saem
  console.log("\nRodando computePromoTagMatches() (com cap PostgREST de 1000)...");
  const { computePromoTagMatches } = await import("../src/lib/promo-tags/matcher");
  const payload = await computePromoTagMatches(ws.id);
  const matches = payload.matches;
  console.log(`computePromoTagMatches devolveu matches para ${Object.keys(matches).length} produtos (cashback=${payload.cashback_percent}%)`);
  for (const t of target || []) {
    const m = matches[t.product_id];
    console.log(`  ${t.product_id} (${t.name?.slice(0, 40)}): ${m ? `${m.length} regra(s) — ${m.map((x: { badge_text: string }) => x.badge_text).join(",")}` : "SEM MATCH"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
