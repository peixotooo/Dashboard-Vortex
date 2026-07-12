/**
 * medusa-catalog-export.ts
 * Exporta o catálogo completo da loja VNDA para um JSON normalizado que será
 * importado no Medusa (migração de plataforma).
 *
 * Uso:
 *   npx tsx scripts/medusa-catalog-export.ts
 *   # token Eccosys do .env.local está REVOGADO — para enriquecer, passe o de prod:
 *   ECCOSYS_API_TOKEN=<token-prod> npx tsx scripts/medusa-catalog-export.ts
 *
 * Saída: output/medusa/catalog-export.json
 *
 * Formatos empíricos (descobertos via probe em 2026-07-12):
 * - GET /api/v2/products?per_page=100&page=N → array direto; header X-Pagination
 *   = {"total_pages","total_count","current_page","next_page"} .
 * - O payload da LISTA é idêntico ao do DETALHE (mesmas keys, variants completas),
 *   mas buscamos o detalhe mesmo assim (fonte de verdade; lista pode truncar).
 * - Variants vêm EMBRULHADAS: [{"6355": {...}}] — unwrap pega o primeiro value.
 * - Tamanho da variante: `attribute1` ("P") e/ou `properties.property1.value`
 *   (property1.name = "Tamanho").
 * - Estoque VNDA: `quantity` = `stock` = `available_quantity` (mesmos valores).
 * - Dimensões já existem na VNDA: weight (kg), width/height/length (cm).
 * - EAN: `barcode` (13 dígitos, prefixo interno 2xx).
 * - Imagens: GET /products/{id}/images → [{id, url, variant_ids}] em ordem de
 *   exibição (capa primeiro); url é protocol-relative (//cdn.vnda.com.br/...).
 * - URL pública do produto: campo `url` já vem completo e é slug + "-{id}"
 *   (ex.: https://www.bulking.com.br/produto/camiseta-oversized-br-94-preta-1478).
 * - Eccosys: /estoques → {codigo, estoqueDisponivel}; /produtos → peso/pesoLiq,
 *   largura/altura/comprimento, gtin, idProdutoMaster, situacao; composição só
 *   em GET /produtos/{id}/atributos → [{descricao, valor}] key "Composição".
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VNDA_THROTTLE_MS = 150;

// ---------- tipos ----------
interface VndaVariantRaw {
  id?: number;
  main?: boolean;
  available?: boolean;
  sku?: string;
  name?: string;
  quantity?: number;
  stock?: number;
  available_quantity?: number;
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  properties?: Record<string, { name?: string; value?: string } | null>;
  price?: number;
  sale_price?: number;
  weight?: number; // kg
  width?: number; // cm
  height?: number; // cm
  length?: number; // cm
  barcode?: string | null;
  product_id?: number;
}

interface VndaProductRaw {
  id: number;
  active?: boolean;
  available?: boolean;
  slug?: string;
  url?: string;
  reference?: string;
  name?: string;
  description?: string;
  html_description?: string;
  plain_description?: string;
  price?: number;
  sale_price?: number;
  tag_names?: string[];
  image_url?: string;
  variants?: Array<VndaVariantRaw | Record<string, VndaVariantRaw>>;
}

interface ExportVariant {
  vnda_variant_id: number | null;
  sku: string | null;
  size: string | null;
  price: number | null;
  sale_price: number | null;
  stock: number;
  ean: string | null;
  weight_g: number | null;
  width_cm: number | null;
  height_cm: number | null;
  length_cm: number | null;
}

interface ExportProduct {
  vnda_id: number;
  slug: string;
  url: string;
  reference: string;
  name: string;
  description: string;
  active: boolean;
  available: boolean;
  tags: string[];
  images: string[];
  price: number | null;
  sale_price: number | null;
  variants: ExportVariant[];
  eccosys: { id: number | null; composition: string | null };
}

// ---------- helpers ----------
function unwrapVariant(v: VndaVariantRaw | Record<string, VndaVariantRaw>): VndaVariantRaw {
  if (v && typeof v === "object" && !("sku" in v) && !("id" in v)) {
    const nested = Object.values(v)[0];
    if (nested && typeof nested === "object") return nested as VndaVariantRaw;
  }
  return v as VndaVariantRaw;
}

const CANONICAL_SIZES = new Set(["P", "M", "G", "GG", "XG", "XGG"]);
const UNICO_ALIASES = new Set(["U", "UN", "UNICO", "UNICA", "TAMANHO UNICO", "TAM UNICO", "ONE SIZE", "OS"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normaliza tamanho para P/M/G/GG/XG/XGG/Único; senão devolve o raw trimado. */
function normalizeSize(raw: string | null | undefined): { size: string | null; canonical: boolean } {
  const t = (raw || "").trim();
  if (!t) return { size: null, canonical: false };
  const up = stripAccents(t.toUpperCase()).replace(/\s+/g, " ");
  if (CANONICAL_SIZES.has(up)) return { size: up, canonical: true };
  if (UNICO_ALIASES.has(up)) return { size: "Único", canonical: true };
  return { size: t, canonical: false };
}

function extractSize(v: VndaVariantRaw): string | null {
  if (v.attribute1 && String(v.attribute1).trim()) return String(v.attribute1).trim();
  const props = v.properties || {};
  for (const key of ["property1", "property2", "property3"]) {
    const p = props[key];
    if (p && typeof p === "object") {
      const name = stripAccents(String(p.name || "").toLowerCase());
      if (name.includes("tamanho") || name.includes("size")) {
        if (p.value && String(p.value).trim()) return String(p.value).trim();
      }
    }
  }
  // fallback: primeiro property com valor
  for (const p of Object.values(props)) {
    if (p && typeof p === "object" && p.value && String(p.value).trim()) return String(p.value).trim();
  }
  return null;
}

function extractVndaStock(v: VndaVariantRaw): number {
  for (const c of [v.quantity, v.stock, v.available_quantity]) {
    if (c !== undefined && c !== null && Number.isFinite(Number(c))) return Math.max(0, Number(c));
  }
  return 0;
}

function normPrice(n: unknown): number | null {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** sale_price só conta se for desconto real (menor que price). */
function normSalePrice(price: number | null, sale: unknown): number | null {
  const s = normPrice(sale);
  if (s === null) return null;
  if (price !== null && s >= price) return null;
  return s;
}

function absolutizeImageUrl(u: string): string {
  if (!u) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://cdn.vnda.com.br" + (u.startsWith("/") ? u : "/" + u);
}

function parseNum(s: unknown): number | null {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- fetch com retry (VNDA) ----------
async function vndaFetch(url: string, headers: Record<string, string>): Promise<Response> {
  let res = await fetch(url, { headers });
  if (res.status === 429 || res.status >= 500) {
    await sleep(2000);
    res = await fetch(url, { headers });
  }
  return res;
}

// ---------- main ----------
(async () => {
  const startedAt = Date.now();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: conn } = await sb
    .from("vnda_connections")
    .select("workspace_id")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) throw new Error("Nenhuma vnda_connection encontrada");

  const api = await import(path.join(process.cwd(), "src/lib/vnda-api.ts"));
  const cfg = await api.getVndaConfigAdmin(conn.workspace_id);
  if (!cfg) throw new Error("Config VNDA não encontrada");
  const H = { Authorization: `Bearer ${cfg.apiToken}`, Accept: "application/json", "X-Shop-Host": cfg.storeHost };
  const B = "https://api.vnda.com.br/api/v2";
  console.log(`[export] loja: ${cfg.storeHost}`);

  // ===== 1. Lista paginada =====
  const rawById = new Map<number, VndaProductRaw>();
  for (let page = 1; page <= 200; page++) {
    const res = await vndaFetch(`${B}/products?per_page=100&page=${page}`, H);
    if (!res.ok) throw new Error(`Lista page ${page} HTTP ${res.status}`);
    const j = (await res.json()) as VndaProductRaw[] | { results?: VndaProductRaw[] };
    const arr: VndaProductRaw[] = Array.isArray(j) ? j : j.results || [];
    if (!arr.length) break;
    for (const p of arr) if (p && typeof p.id === "number") rawById.set(p.id, p);
    let hasNext = arr.length >= 100;
    try {
      const pag = JSON.parse(res.headers.get("X-Pagination") || "{}");
      if (typeof pag.next_page === "boolean") hasNext = pag.next_page;
      if (page === 1) console.log(`[export] X-Pagination: ${res.headers.get("X-Pagination")}`);
    } catch {
      /* header ausente — segue pela heurística de tamanho */
    }
    if (!hasNext) break;
    await sleep(VNDA_THROTTLE_MS);
  }
  const allProducts = [...rawById.values()];
  const activeProducts = allProducts.filter((p) => p.active === true).sort((a, b) => a.id - b.id);
  console.log(`[export] lista: ${allProducts.length} produtos (ativos: ${activeProducts.length})`);

  // ===== 2+3. Detalhe + imagens por produto =====
  interface Collected {
    product: VndaProductRaw;
    variants: VndaVariantRaw[];
    images: string[];
  }
  const collected: Collected[] = [];
  const problems: Array<{ vnda_id: number; reference: string; issue: string }> = [];

  let i = 0;
  for (const listP of activeProducts) {
    i++;
    let detail: VndaProductRaw | null = null;
    try {
      const res = await vndaFetch(`${B}/products/${listP.id}`, H);
      if (res.ok) detail = (await res.json()) as VndaProductRaw;
      else problems.push({ vnda_id: listP.id, reference: listP.reference || "", issue: `detalhe HTTP ${res.status} — usando payload da lista` });
    } catch (e) {
      problems.push({ vnda_id: listP.id, reference: listP.reference || "", issue: `detalhe erro ${(e as Error).message} — usando payload da lista` });
    }
    const product = detail && typeof detail.id === "number" ? detail : listP;
    const variants = (product.variants || []).map(unwrapVariant).filter((v) => v && typeof v === "object");
    await sleep(VNDA_THROTTLE_MS);

    let images: string[] = [];
    try {
      const res = await vndaFetch(`${B}/products/${listP.id}/images`, H);
      if (res.ok) {
        const arr = (await res.json()) as Array<{ url?: string }>;
        if (Array.isArray(arr)) images = arr.map((im) => absolutizeImageUrl(im.url || "")).filter(Boolean);
      } else {
        problems.push({ vnda_id: listP.id, reference: listP.reference || "", issue: `imagens HTTP ${res.status}` });
      }
    } catch (e) {
      problems.push({ vnda_id: listP.id, reference: listP.reference || "", issue: `imagens erro ${(e as Error).message}` });
    }
    if (!images.length && product.image_url) images = [absolutizeImageUrl(product.image_url)];
    await sleep(VNDA_THROTTLE_MS);

    collected.push({ product, variants, images });
    if (i % 25 === 0 || i === activeProducts.length) {
      console.log(`[export] detalhe+imagens ${i}/${activeProducts.length} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    }
  }

  // ===== 4. Enriquecimento Eccosys (best-effort) =====
  // Token do .env.local pode estar REVOGADO (memória do projeto) — testConnection primeiro.
  let eccosysEnrichment = false;
  const eccStock = new Map<string, number>(); // codigo -> estoqueDisponivel
  interface EccProd {
    id: number | null;
    gtin: string | null;
    peso: number | null; // kg
    largura: number | null;
    altura: number | null;
    comprimento: number | null;
  }
  const eccProd = new Map<string, EccProd>(); // codigo -> dados
  const eccComposition = new Map<string, string | null>(); // reference -> composição
  let eccModule: typeof import("../src/lib/eccosys/client") | null = null;

  try {
    eccModule = await import(path.join(process.cwd(), "src/lib/eccosys/client.ts"));
    const token = process.env.ECCOSYS_API_TOKEN || "";
    const ambiente = (process.env.ECCOSYS_AMBIENTE || "producao").toLowerCase();
    const ok = token ? await eccModule.eccosys.testConnection(token, ambiente) : false;
    if (!ok) {
      console.log("[export] Eccosys testConnection FALHOU (token revogado/ausente) — pulando enriquecimento");
    } else {
      eccosysEnrichment = true;
      console.log("[export] Eccosys OK — puxando /estoques ...");
      const estoques = await eccModule.eccosys.listAll<{ codigo?: string; estoqueDisponivel?: number | string }>(
        "/estoques",
        undefined,
        {},
        100
      );
      for (const e of estoques) {
        if (e?.codigo) {
          const n = Number(e.estoqueDisponivel);
          eccStock.set(String(e.codigo), Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
        }
      }
      console.log(`[export] Eccosys /estoques: ${eccStock.size} códigos`);

      console.log("[export] Eccosys /produtos ($situacao=A) ...");
      const produtos = await eccModule.eccosys.listAll<Record<string, unknown>>(
        "/produtos",
        undefined,
        { $situacao: "A" },
        100
      );
      for (const p of produtos) {
        const codigo = p.codigo ? String(p.codigo) : null;
        if (!codigo) continue;
        eccProd.set(codigo, {
          id: p.id !== undefined && p.id !== null && Number.isFinite(Number(p.id)) ? Number(p.id) : null,
          gtin: p.gtin ? String(p.gtin) : null,
          peso: parseNum(p.peso) ?? parseNum(p.pesoLiq) ?? parseNum(p.pesoBruto),
          largura: parseNum(p.largura) ?? parseNum(p.larguraReal),
          altura: parseNum(p.altura) ?? parseNum(p.alturaReal),
          comprimento: parseNum(p.comprimento) ?? parseNum(p.comprimentoReal),
        });
      }
      console.log(`[export] Eccosys /produtos: ${eccProd.size} códigos ativos`);

      // Composição: só em GET /produtos/{id}/atributos, por produto-master (throttle 1 req/s embutido)
      const refs = collected.map((c) => String(c.product.reference || "")).filter((r) => r && eccProd.has(r));
      console.log(`[export] Eccosys composição: ${refs.length} masters encontrados por codigo=reference (1 req/s, ~${refs.length}s) ...`);
      let done = 0;
      for (const ref of refs) {
        const master = eccProd.get(ref)!;
        if (master.id === null) continue;
        try {
          const attrs = await eccModule.eccosys.get<Array<{ descricao?: string; nome?: string; valor?: string }>>(
            `/produtos/${master.id}/atributos`
          );
          if (Array.isArray(attrs)) {
            const comp = attrs.find((a) => stripAccents(String(a.descricao || a.nome || "").toLowerCase()) === "composicao");
            eccComposition.set(ref, comp?.valor ? String(comp.valor) : null);
          }
        } catch {
          /* best-effort — segue sem composição */
        }
        done++;
        if (done % 100 === 0) console.log(`[export] composição ${done}/${refs.length}`);
      }
      console.log(`[export] composição concluída: ${[...eccComposition.values()].filter(Boolean).length} com valor`);
    }
  } catch (e) {
    console.log(`[export] Eccosys indisponível (${(e as Error).message}) — pulando enriquecimento`);
    eccosysEnrichment = false;
  }

  // ===== 5. Monta o JSON final =====
  const stats = {
    products: 0,
    variants: 0,
    images: 0,
    eccosys_enrichment: eccosysEnrichment,
    missing_sku: 0,
    missing_size: 0,
    missing_dims: 0,
    distinct_tags: {} as Record<string, number>,
    // extras diagnósticos (aditivos — não fazem parte do contrato mínimo)
    size_raw_counts: {} as Record<string, number>,
    eccosys_stock_hits: 0,
    eccosys_dims_hits: 0,
    eccosys_composition_hits: 0,
    skipped_products: problems,
  };

  const products: ExportProduct[] = [];
  for (const { product: p, variants: rawVariants, images } of collected) {
    const price = normPrice(p.price);
    const salePrice = normSalePrice(price, p.sale_price);
    const tags = Array.isArray(p.tag_names) ? p.tag_names.map((t) => String(t)) : [];
    for (const t of tags) stats.distinct_tags[t] = (stats.distinct_tags[t] || 0) + 1;

    const reference = String(p.reference || "");
    const master = eccosysEnrichment ? eccProd.get(reference) || null : null;

    const variants: ExportVariant[] = rawVariants.map((v) => {
      const sku = v.sku ? String(v.sku) : null;
      if (!sku) stats.missing_sku++;

      const { size } = normalizeSize(extractSize(v));
      if (!size) stats.missing_size++;
      else if (!CANONICAL_SIZES.has(size) && size !== "Único")
        stats.size_raw_counts[size] = (stats.size_raw_counts[size] || 0) + 1;

      const vPrice = normPrice(v.price) ?? price;
      const vSale = normSalePrice(vPrice, v.sale_price) ?? (vPrice === price ? salePrice : null);

      // Estoque: Eccosys (fonte de verdade) por SKU; fallback VNDA
      let stock = extractVndaStock(v);
      if (eccosysEnrichment && sku && eccStock.has(sku)) {
        stock = eccStock.get(sku)!;
        stats.eccosys_stock_hits++;
      }

      // Dimensões/peso: Eccosys filho (por sku) > Eccosys master (por reference) > VNDA variant
      const child = eccosysEnrichment && sku ? eccProd.get(sku) || null : null;
      const kg = child?.peso ?? master?.peso ?? parseNum(v.weight);
      const width = child?.largura ?? master?.largura ?? parseNum(v.width);
      const height = child?.altura ?? master?.altura ?? parseNum(v.height);
      const length = child?.comprimento ?? master?.comprimento ?? parseNum(v.length);
      if (child?.peso || child?.largura || master?.peso || master?.largura) stats.eccosys_dims_hits++;
      const weight_g = kg !== null ? Math.round(kg * 1000) : null;
      if (weight_g === null || width === null || height === null || length === null) stats.missing_dims++;

      const ean = child?.gtin || (v.barcode ? String(v.barcode) : null) || null;

      return {
        vnda_variant_id: typeof v.id === "number" ? v.id : null,
        sku,
        size,
        price: vPrice,
        sale_price: vSale,
        stock,
        ean,
        weight_g,
        width_cm: width,
        height_cm: height,
        length_cm: length,
      };
    });

    const composition = eccComposition.get(reference) ?? null;
    if (composition) stats.eccosys_composition_hits++;

    products.push({
      vnda_id: p.id,
      slug: String(p.slug || ""),
      url: String(p.url || (p.slug ? `https://${cfg.storeHost}/produto/${p.slug}-${p.id}` : "")),
      reference,
      name: String(p.name || ""),
      description: String(p.html_description || p.description || p.plain_description || ""),
      active: p.active === true,
      available: p.available === true,
      tags,
      images,
      price,
      sale_price: salePrice,
      variants,
      eccosys: { id: master?.id ?? null, composition },
    });

    stats.products++;
    stats.variants += variants.length;
    stats.images += images.length;
  }

  products.sort((a, b) => a.vnda_id - b.vnda_id);

  const out = {
    version: 1,
    exported_at: new Date().toISOString(),
    store_host: cfg.storeHost,
    stats,
    products,
  };

  const outDir = path.join(process.cwd(), "output", "medusa");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "catalog-export.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n[export] OK → ${outPath} (${sizeMb} MB) em ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(`[export] produtos: ${stats.products} | variantes: ${stats.variants} | imagens: ${stats.images}`);
  console.log(
    `[export] eccosys_enrichment: ${stats.eccosys_enrichment} | stock hits: ${stats.eccosys_stock_hits} | dims hits: ${stats.eccosys_dims_hits} | composição: ${stats.eccosys_composition_hits}`
  );
  console.log(`[export] missing_sku: ${stats.missing_sku} | missing_size: ${stats.missing_size} | missing_dims: ${stats.missing_dims}`);
  const topTags = Object.entries(stats.distinct_tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  console.log(`[export] top tags:\n${topTags.map(([t, n]) => `  ${t}: ${n}`).join("\n")}`);
  if (problems.length) console.log(`[export] problemas (${problems.length}):\n${problems.map((p) => `  #${p.vnda_id} ${p.reference}: ${p.issue}`).join("\n")}`);
})().catch((e) => {
  console.error("[export] ERRO FATAL:", e);
  process.exit(1);
});
