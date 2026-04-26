// Verifica se /api/v2/products (listing paginado) retorna tag_names
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase-admin";
import { decrypt } from "../src/lib/encryption";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id").ilike("name", "%bulking%").limit(1).single();
  const { data: conn } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", ws!.id)
    .order("created_at", { ascending: false })
    .limit(1).single();
  const apiToken = decrypt(conn!.api_token);
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
    "X-Shop-Host": conn!.store_host,
  };

  const r = await fetch("https://api.vnda.com.br/api/v2/products?page=1&per_page=3", { headers });
  const arr = await r.json();
  console.log(`Status ${r.status} — ${arr.length} produtos`);
  for (const p of arr.slice(0, 3)) {
    console.log(`\n--- product id=${p.id} name=${p.name?.slice(0, 50)}`);
    console.log(`  has tag_names? ${p.tag_names ? `YES (${p.tag_names.length})` : "NO"}`);
    console.log(`  has category_tags? ${p.category_tags ? `YES (${p.category_tags.length})` : "NO"}`);
    console.log(`  keys:`, Object.keys(p).join(", "));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
