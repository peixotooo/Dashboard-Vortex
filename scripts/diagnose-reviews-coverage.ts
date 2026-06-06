/* eslint-disable @typescript-eslint/no-explicit-any */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getYourViewsConfig, iterateAllReviews } from "../src/lib/reviews/yourviews-api";

// Diagnóstico: o catálogo VNDA (shelf_products) está sincronizado? E os
// identificadores de produto do Yourviews casam com ele — por product_id, sku
// ou nome? Define como deve ser o "resolver" de vinculação review->produto VNDA.

function normName(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function main() {
  const WS = process.argv.find((a) => a.startsWith("--workspace="))?.split("=")[1]
    || "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. shelf_products
  const { data: prods, error } = await admin
    .from("shelf_products")
    .select("product_id, sku, name, active, image_url, product_url")
    .eq("workspace_id", WS);
  if (error) { console.error("shelf_products erro:", error.message); process.exit(1); }
  const products = prods || [];
  const active = products.filter((p) => p.active);
  console.log(`shelf_products: ${products.length} total, ${active.length} ativos`);
  if (products.length === 0) {
    console.log("\n⚠️  Catálogo VNDA não sincronizado. Rode o sync de catálogo das prateleiras antes.");
    return;
  }

  const byId = new Map<string, any>();
  const bySku = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const p of products) {
    if (p.product_id) byId.set(String(p.product_id), p);
    if (p.sku) bySku.set(String(p.sku).toLowerCase(), p);
    const n = normName(p.name);
    if (n) byName.set(n, p);
  }

  // 2. Amostra do Yourviews
  const cfg = await getYourViewsConfig(WS);
  if (!cfg) { console.error("Sem credenciais Yourviews"); process.exit(1); }

  let total = 0;
  const hit = { id: 0, sku: 0, name: 0, none: 0 };
  const hitActive = { id: 0, sku: 0, name: 0 };
  let withPhotos = 0;
  const photoSamples: string[] = [];
  const unresolvedSamples: string[] = [];

  for await (const r of iterateAllReviews(cfg, { count: 100, maxPages: 5 })) {
    total++;
    const pid = r.Product?.ProductId ? String(r.Product.ProductId) : "";
    const sku = r.Product?.Sku ? String(r.Product.Sku).toLowerCase() : "";
    const nm = normName(r.Product?.Name);

    let match: any = null;
    let via = "";
    if (pid && byId.has(pid)) { match = byId.get(pid); via = "id"; }
    else if (sku && bySku.has(sku)) { match = bySku.get(sku); via = "sku"; }
    else if (nm && byName.has(nm)) { match = byName.get(nm); via = "name"; }

    if (!match) {
      hit.none++;
      if (unresolvedSamples.length < 6) unresolvedSamples.push(`${r.Product?.Name} (yvId ${pid}, sku ${sku || "-"})`);
    } else {
      (hit as any)[via]++;
      if (match.active) (hitActive as any)[via]++;
    }

    const photos = r.CustomerPhotos;
    if (Array.isArray(photos) && photos.length > 0) {
      withPhotos++;
      if (photoSamples.length < 3) photoSamples.push(JSON.stringify(photos[0]));
    }
  }

  const matched = hit.id + hit.sku + hit.name;
  const matchedActive = hitActive.id + hitActive.sku + hitActive.name;
  console.log(`\nAmostra Yourviews: ${total} reviews`);
  console.log(`Vinculados ao catálogo VNDA: ${matched}/${total} (${((matched / total) * 100).toFixed(0)}%)`);
  console.log(`  por product_id: ${hit.id}  | por sku: ${hit.sku}  | por nome: ${hit.name}`);
  console.log(`  destes, em produto ATIVO: ${matchedActive} (id ${hitActive.id}, sku ${hitActive.sku}, nome ${hitActive.name})`);
  console.log(`Sem vínculo (produto não existe na VNDA): ${hit.none}`);
  if (unresolvedSamples.length) console.log("  ex.: " + unresolvedSamples.join(" | "));
  console.log(`\nReviews com foto de cliente: ${withPhotos}/${total}`);
  if (photoSamples.length) console.log("  shape CustomerPhotos[0]: " + photoSamples.join("  ||  "));
}

main().catch((e) => { console.error(e); process.exit(1); });
