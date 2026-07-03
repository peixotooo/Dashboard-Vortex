// Sincroniza as tabelas de medidas do assistente, por MOLDE.
//
// A vitrine está atrás de Cloudflare (bloqueia o fetch do datacenter da
// Vercel), então extraímos as medidas AQUI (IP confiável) e gravamos em
// assistant_size_guides. O runtime só lê. Rode quando cadastrar molde novo ou
// mudar medidas.
//
// Uso:
//   npx tsx scripts/assistant-sizeguide-sync.ts          → dry-run
//   npx tsx scripts/assistant-sizeguide-sync.ts --apply  → grava no banco
//
// Requer migration-130-assistant-size-guides.sql aplicada.

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { extractSizeGuideFromHtml } from "../src/lib/assistant/catalog";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function moldeOf(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  const g = tags.find(
    (t) => t && typeof t === "object" && (t as { tag_type?: string }).tag_type === "guia-de-medidas"
  ) as { name?: string } | undefined;
  return g?.name || null;
}

(async () => {
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: conn } = await sb
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) throw new Error("sem vnda_connection");
  const ws = conn.workspace_id as string;

  const { data: sp } = await sb
    .from("shelf_products")
    .select("product_id, name, product_url, tags, active")
    .eq("workspace_id", ws)
    .eq("active", true)
    .limit(5000);
  const rows = (sp || []).filter((r) => !/\bkit\b/i.test(r.name || ""));

  // A PDP vive em /produto/{slug}-{id}, mas product_url no espelho vem SÓ com o
  // slug (sem -id) → 404. Anexa o id.
  const pdpUrl = (productUrl: string, id: string): string => {
    const base = (productUrl || "").replace(/\/+$/, "");
    if (!base) return "";
    return new RegExp(`-${id}(/|\\?|#|$)`).test(base) ? base : `${base}-${id}`;
  };

  // 1 produto representante por molde (o 1º com product_url válido)
  const byMolde = new Map<string, { url: string; sample: string }>();
  for (const r of rows) {
    const molde = moldeOf(r.tags);
    const url = pdpUrl(String(r.product_url || ""), String(r.product_id));
    if (!molde || !/^https?:\/\//.test(url) || byMolde.has(molde)) continue;
    byMolde.set(molde, { url, sample: r.name });
  }
  console.log(`workspace ${ws} · ${byMolde.size} moldes a sincronizar\n`);

  const results: Array<{ molde: string; guide: string }> = [];
  let fail = 0;
  for (const [molde, info] of byMolde) {
    process.stdout.write(`${molde} (${info.sample}) ... `);
    try {
      const res = await fetch(info.url, {
        headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        fail++;
        continue;
      }
      const guide = extractSizeGuideFromHtml(await res.text());
      if (!guide) {
        console.log("sem tabela");
        fail++;
        continue;
      }
      results.push({ molde, guide });
      console.log("ok (" + guide.split("\n")[0] + " ...)");
    } catch (e) {
      console.log(`erro ${e instanceof Error ? e.message : e}`);
      fail++;
    }
    await sleep(400); // gentil com a vitrine
  }

  console.log(`\nextraídas: ${results.length} · falhas: ${fail}`);
  if (!apply) {
    console.log("\nDry-run. Rode com --apply pra gravar.");
    return;
  }
  for (const r of results) {
    const { error } = await sb.from("assistant_size_guides").upsert(
      { workspace_id: ws, molde: r.molde, guide: r.guide, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,molde" }
    );
    if (error) {
      console.error(`falha em ${r.molde}: ${error.message}`);
      console.error("→ migration-130 aplicada?");
      process.exit(1);
    }
  }
  console.log(`✓ ${results.length} moldes gravados em assistant_size_guides`);
})().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
