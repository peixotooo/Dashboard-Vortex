// Rollout do Assistente de Vendas por ondas.
//
// Uso:
//   npx tsx scripts/assistant-rollout.ts --curve-a           → dry-run da onda curva-A (camisetas+regatas classe A)
//   npx tsx scripts/assistant-rollout.ts --curve-a --apply   → aplica (UNIÃO com os ids já liberados)
//   npx tsx scripts/assistant-rollout.ts --all --apply       → libera em TODAS as PDPs (product_ids = ["*"])
//   npx tsx scripts/assistant-rollout.ts --list              → mostra o que está liberado hoje
//
// Curva-A vem do snapshot crm_abc_snapshots (product_id = SKU-pai) e é mapeada
// pro product_id REAL da VNDA via shelf_products (prefixo de SKU → nome).
// Config pública propaga em ~2min (cache CDN do /api/assistant/config).

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const norm = (s: string) =>
  (s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
const stripVar = (s: string) => {
  const m = (s || "").match(/^(.+)-(\d{1,5})$/);
  return m ? m[1] : s || "";
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");
  const curveA = args.includes("--curve-a");
  const list = args.includes("--list");

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

  const { data: settings } = await sb
    .from("assistant_settings")
    .select("enabled, product_ids")
    .eq("workspace_id", ws)
    .maybeSingle();
  const current: string[] = Array.isArray(settings?.product_ids)
    ? settings!.product_ids.map(String)
    : [];
  console.log(`workspace: ${ws} (${conn.store_host})`);
  console.log(`enabled: ${settings?.enabled} | liberados hoje: ${current.length} ids`);

  if (list) {
    console.log(JSON.stringify(current));
    return;
  }

  if (all) {
    if (!apply) {
      console.log('\nDry-run. Com --apply: product_ids = ["*"] (todas as PDPs)');
      return;
    }
    await sb
      .from("assistant_settings")
      .update({ product_ids: ["*"], updated_at: new Date().toISOString() })
      .eq("workspace_id", ws);
    console.log('✓ liberado em TODAS as PDPs (["*"]) — propaga em ~2min');
    return;
  }

  if (!curveA) {
    console.log("\nUse --curve-a, --all ou --list.");
    return;
  }

  // --- Onda curva-A: camisetas + regatas classe A (sem kit) ---
  const { data: snap } = await sb
    .from("crm_abc_snapshots")
    .select("computed_at, products")
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!snap) throw new Error("sem snapshot ABC");
  const products: Array<{ product_id?: unknown; name?: string; abc_class?: string; revenue?: number }> =
    Array.isArray(snap.products) ? snap.products : [];
  console.log(`snapshot ABC: ${snap.computed_at}`);

  const wave = products.filter(
    (p) =>
      p.abc_class === "A" &&
      /camiseta|regata/i.test(p.name || "") &&
      !/kit/i.test(p.name || "")
  );

  const { data: sp } = await sb
    .from("shelf_products")
    .select("product_id, name, sku, product_url, active, in_stock")
    .eq("workspace_id", ws)
    .limit(5000);
  const rows = (sp || []).filter(
    (x) => !/kit/i.test(x.name || "") && x.active !== false
  );
  const byName = new Map<string, (typeof rows)[number]>();
  const bySkuPrefix = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    byName.set(norm(r.name), r);
    const pfx = stripVar(String(r.sku || ""));
    if (pfx) bySkuPrefix.set(pfx, r);
  }

  const resolved: Array<{ vndaId: string; name: string; revenue: number }> = [];
  const misses: string[] = [];
  for (const p of wave) {
    const pid = String(p.product_id || "");
    let m = (pid && bySkuPrefix.get(pid)) || byName.get(norm(p.name || ""));
    if (!m) {
      const toks = norm(p.name || "").split(" ").filter(Boolean);
      m = rows.find((r) => {
        const n = norm(r.name);
        return toks.every((t) => n.includes(t));
      });
    }
    if (m) {
      resolved.push({
        vndaId: String(m.product_id),
        name: p.name || "",
        revenue: Number(p.revenue) || 0,
      });
    } else {
      misses.push(p.name || "?");
    }
  }

  resolved.sort((a, b) => b.revenue - a.revenue);
  const waveIds = [...new Set(resolved.map((r) => r.vndaId))];
  const merged = [...new Set([...current, ...waveIds])];

  console.log(`\ncurva-A camisetas/regatas: ${wave.length} itens → ${waveIds.length} PDPs mapeadas`);
  resolved.forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. [${r.vndaId}] ${r.name} (R$${Math.round(r.revenue)})`)
  );
  if (misses.length) console.log(`  não mapeados (${misses.length}): ${misses.join(" | ")}`);
  console.log(`\nliberados hoje: ${current.length} → após onda: ${merged.length}`);

  if (!apply) {
    console.log("\nDry-run. Rode com --apply pra liberar.");
    return;
  }
  const { error } = await sb
    .from("assistant_settings")
    .update({ product_ids: merged, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws);
  if (error) throw new Error(error.message);
  console.log(`\n✓ onda aplicada: ${merged.length} PDPs liberadas — propaga em ~2min`);
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
