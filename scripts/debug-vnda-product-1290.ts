// Busca direto na VNDA o que vem nas tags do produto 1290
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";
import { decrypt } from "../src/lib/encryption";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace nao encontrado");

  const { data: conn } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", ws.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!conn) throw new Error("vnda_connections nao encontrado");
  const apiToken = decrypt(conn.api_token);
  const storeHost = conn.store_host;
  console.log("Loja:", storeHost);

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
    "X-Shop-Host": storeHost,
  };

  // 1. /api/v2/products/1290
  console.log("\n=== /api/v2/products/1290 (single) ===");
  const r1 = await fetch("https://api.vnda.com.br/api/v2/products/1290", { headers });
  const d1 = await r1.json();
  console.log(`status ${r1.status}`);
  console.log(`name: ${d1.name}`);
  console.log(`available: ${d1.available}`);
  console.log(`tag_names:`, d1.tag_names);
  console.log(`category_tags (count):`, (d1.category_tags || []).length);
  if (d1.category_tags?.length) {
    console.log("  category_tags:", d1.category_tags.map((t: { name: string; tag_type: string }) => `${t.name}(${t.tag_type})`).join(", "));
  }

  // 2. /api/v2/products/search com query=1290 ou tag=combos
  console.log("\n=== /api/v2/products/search?id=1290 ===");
  const r2 = await fetch(`https://${storeHost}/api/v2/products/search?per_page=200&q=destruction+preta`, { headers });
  if (r2.ok) {
    const d2 = await r2.json();
    const arr = Array.isArray(d2) ? d2 : (d2.results || []);
    const found = arr.find((p: { id: number }) => p.id === 1290);
    if (found) {
      console.log(`Encontrado via search`);
      console.log(`tag_names:`, found.tag_names);
      console.log(`category_tags (count):`, (found.category_tags || []).length);
      if (found.category_tags?.length) {
        console.log("  category_tags:", found.category_tags.map((t: { name: string; tag_type: string }) => `${t.name}(${t.tag_type})`).join(", "));
      }
    } else {
      console.log(`Nao encontrado nos ${arr.length} resultados`);
    }
  } else {
    console.log(`status ${r2.status}`);
    console.log(await r2.text());
  }

  // 3. Lista TODAS as tags da loja para ver se "combos" existe
  console.log("\n=== /api/v2/tags ===");
  const r3 = await fetch("https://api.vnda.com.br/api/v2/tags?per_page=200", { headers });
  if (r3.ok) {
    const d3 = await r3.json();
    const arr = Array.isArray(d3) ? d3 : (d3.results || d3.tags || []);
    console.log(`Total tags retornadas: ${arr.length}`);
    const comboTags = arr.filter((t: { name?: string }) => (t.name || "").toLowerCase().includes("combo"));
    console.log(`Tags com "combo":`);
    for (const t of comboTags) {
      console.log(`  name="${t.name}" type="${t.tag_type || t.type}" products_count=${t.products_count || "?"}`);
    }
  } else {
    console.log(`status ${r3.status}`);
  }

  // 4. Busca produtos com a tag combos via search local-host
  console.log("\n=== Busca produtos pela tag combos via search ===");
  const r4 = await fetch(`https://${storeHost}/api/v2/products/search?tag=combos&per_page=20`, { headers });
  if (r4.ok) {
    const d4 = await r4.json();
    const arr = Array.isArray(d4) ? d4 : (d4.results || []);
    console.log(`Total produtos com tag=combos: ${arr.length}`);
    arr.slice(0, 10).forEach((p: { id: number; name: string }) => console.log(`  ${p.id} - ${p.name}`));
  } else {
    console.log(`status ${r4.status}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
