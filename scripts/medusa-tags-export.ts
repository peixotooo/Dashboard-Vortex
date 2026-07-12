/**
 * Exporta TODAS as tags da VNDA (objetos completos: type, title, subtitle,
 * description HTML, image_url) para output/medusa/tags-export.json.
 * Complementa o catalog-export (que só tem tag_names por produto).
 * Uso: npx tsx scripts/medusa-tags-export.ts
 */
import * as dotenv from "dotenv"; import * as path from "path"; import * as fs from "fs";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: conn } = await sb.from("vnda_connections").select("workspace_id").order("is_default", { ascending: false }).limit(1).maybeSingle();
  const api = await import(path.join(process.cwd(), "src/lib/vnda-api.ts"));
  const cfg = await api.getVndaConfigAdmin(conn!.workspace_id);
  const H = { Authorization: `Bearer ${cfg.apiToken}`, Accept: "application/json", "X-Shop-Host": cfg.storeHost };
  const all: unknown[] = [];
  for (let page = 1; page <= 300; page++) {
    const r = await fetch(`https://api.vnda.com.br/api/v2/tags?per_page=100&page=${page}`, { headers: H });
    if (!r.ok) throw new Error(`GET /tags page ${page}: ${r.status}`);
    const arr: unknown[] = await r.json();
    if (!arr.length) break;
    all.push(...arr);
    const pag = r.headers.get("x-pagination");
    if (pag && !JSON.parse(pag).next_page) break;
    await sleep(120);
  }
  fs.mkdirSync(path.join(process.cwd(), "output/medusa"), { recursive: true });
  const out = { version: 1, exported_at: new Date().toISOString(), tags: all };
  fs.writeFileSync(path.join(process.cwd(), "output/medusa/tags-export.json"), JSON.stringify(out, null, 1));
  const types: Record<string, number> = {};
  for (const t of all as { type?: string | null; description?: string | null; image_url?: string | null }[]) {
    const k = t.type || "(sem type)";
    types[k] = (types[k] || 0) + 1;
  }
  console.log(`tags: ${all.length}`);
  console.log("types:", JSON.stringify(types, null, 1));
  const withContent = (all as { description?: string | null; image_url?: string | null }[]).filter((t) => t.description || t.image_url).length;
  console.log("com conteúdo (description/image_url):", withContent);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
