// Dispara sincronizacao do catalogo (shelf_products) com a VNDA do Bulking.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";
import { syncCatalog } from "../src/lib/shelves/catalog-sync";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace nao encontrado");
  console.log(`Sincronizando catalogo do workspace: ${ws.name} (${ws.id})`);
  console.log("(isso pode demorar 30s-2min dependendo do total de produtos na VNDA)\n");

  const t0 = Date.now();
  const result = await syncCatalog(ws.id);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nSync concluido em ${dt}s`);
  console.log(`  Total VNDA: ${result.total}`);
  console.log(`  Sincronizados: ${result.synced}`);
  console.log(`  Erros: ${result.errors}`);

  // Verifica produto 1290
  const { data: p } = await admin
    .from("shelf_products")
    .select("product_id, name, tags, updated_at")
    .eq("workspace_id", ws.id)
    .eq("product_id", "1290")
    .single();
  console.log(`\nProduto 1290 apos sync:`);
  console.log(`  name: ${p?.name}`);
  console.log(`  updated_at: ${p?.updated_at}`);
  const tags = p?.tags as Array<{ name?: string } | string>;
  const tagNames = (tags || []).map((t) => typeof t === "string" ? t : t?.name).filter(Boolean);
  console.log(`  tags (${tagNames.length}): ${tagNames.join(", ")}`);
  console.log(`  tem "combos"? ${tagNames.includes("combos") ? "SIM ✓" : "NAO ✗"}`);

  // Quantos produtos com combos agora
  const PAGE = 1000;
  let from = 0;
  let comboCount = 0;
  while (true) {
    const { data: page } = await admin
      .from("shelf_products")
      .select("tags")
      .eq("workspace_id", ws.id)
      .eq("active", true)
      .eq("in_stock", true)
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    for (const r of page) {
      const arr = r.tags as Array<{ name?: string } | string>;
      if (!Array.isArray(arr)) continue;
      const has = arr.some((t) => {
        const n = typeof t === "string" ? t : t?.name;
        return (n || "").toLowerCase().trim() === "combos";
      });
      if (has) comboCount++;
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\nTotal de produtos active+in_stock com tag "combos": ${comboCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
