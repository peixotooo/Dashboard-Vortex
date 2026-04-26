// Lista todas as tags unicas no shelf_products do Bulking + busca "combo"
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace nao encontrado");

  // Pega TODOS os produtos (active OU nao)
  const { data: all, count } = await admin
    .from("shelf_products")
    .select("product_id, name, tags, active, in_stock", { count: "exact" })
    .eq("workspace_id", ws.id)
    .limit(2000);
  console.log(`Total de shelf_products no workspace: ${count} (carregados ${all?.length})`);

  const tagCounts = new Map<string, { count: number; sample?: string }>();
  let withTag1290Combo = 0;
  for (const p of all || []) {
    const tags = (p.tags as { vnda_tags?: Array<{ name?: string }> } | null);
    const arr = tags?.vnda_tags || (Array.isArray(p.tags) ? (p.tags as Array<{ name?: string }>) : []);
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      const n = (t?.name || "").toLowerCase().trim();
      if (!n) continue;
      const cur = tagCounts.get(n) || { count: 0 };
      cur.count++;
      if (!cur.sample) cur.sample = p.name;
      tagCounts.set(n, cur);
      if (n.includes("combo") && p.product_id === "1290") withTag1290Combo++;
    }
  }

  // Tags que contem "combo"
  const comboTags = [...tagCounts.entries()].filter(([n]) => n.includes("combo"));
  console.log(`\n=== Tags contendo "combo" ===`);
  for (const [n, info] of comboTags) {
    console.log(`  "${n}" — ${info.count} produtos (ex: ${info.sample})`);
  }

  // Top 30 tags por uso
  console.log(`\n=== Top 30 tags por uso ===`);
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 30);
  for (const [n, info] of sorted) {
    console.log(`  ${String(info.count).padStart(4)} - ${n}`);
  }

  // Verifica quando o produto 1290 foi sincronizado pela ultima vez
  const { data: p1290 } = await admin
    .from("shelf_products")
    .select("product_id, name, tags, last_synced_at, updated_at, created_at, active, in_stock")
    .eq("workspace_id", ws.id)
    .eq("product_id", "1290")
    .single();
  console.log(`\n=== Produto 1290 ===`);
  console.log(`name: ${p1290?.name}`);
  console.log(`active: ${p1290?.active} in_stock: ${p1290?.in_stock}`);
  console.log(`last_synced_at: ${p1290?.last_synced_at}`);
  console.log(`updated_at: ${p1290?.updated_at}`);
  console.log(`created_at: ${p1290?.created_at}`);
  console.log(`tags: ${JSON.stringify(p1290?.tags)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
