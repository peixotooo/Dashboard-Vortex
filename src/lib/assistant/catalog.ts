// Camada de dados do assistente — SOMENTE LEITURA de catálogo.
//
// Fontes:
//  1. shelf_products (espelho local do catálogo VNDA, sincronizado por hora) —
//     busca/recomendação rápida sem bater na VNDA.
//  2. VNDA GET /products/{id} ao vivo — só para disponibilidade por tamanho.
//
// REGRA DURA: quantidades de estoque são descartadas AQUI, na borda do dado.
// O LLM nunca recebe números de estoque — só boolean disponível/indisponível.
// Assim nem prompt injection consegue extrair o que o modelo não viu.

import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigAdmin, type VndaConfig } from "@/lib/vnda-api";
import type {
  AssistantProductDetails,
  AssistantProductSummary,
  AssistantSizeAvailability,
} from "./types";

// --- Linha crua do shelf_products ---

interface ShelfProductRow {
  product_id: string;
  name: string;
  sku: string | null;
  tags: unknown;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
  active: boolean | null;
  in_stock: boolean | null;
}

const SELECT_COLS =
  "product_id, name, sku, tags, price, sale_price, image_url, product_url, active, in_stock";

// --- Derivações de atributos (nome/tags → fit, tecido, composição) ---

const MATERIAL_LABELS: Record<string, string> = {
  algodao: "ALGODÃO",
  elastano: "ELASTANO",
  poliester: "POLIÉSTER",
  poliamida: "POLIAMIDA",
  viscose: "VISCOSE",
};

function tagList(raw: unknown): Array<{ name: string; type: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      if (typeof t === "string") return { name: t, type: "" };
      if (t && typeof t === "object") {
        // shelf_products (espelho) usa `tag_type`; a search da VNDA usa `type`.
        // Aceita os dois pra não depender da fonte.
        const o = t as { name?: unknown; type?: unknown; tag_type?: unknown };
        return {
          name: String(o.name || ""),
          type: String(o.tag_type || o.type || ""),
        };
      }
      return { name: "", type: "" };
    })
    .filter((t) => t.name);
}

/** "96-algodao-4-elastano" → "96% ALGODÃO · 4% ELASTANO" */
export function parseFichaTecnica(raw: unknown): string | null {
  const ficha = tagList(raw).find((t) => t.type === "ficha-tecnica");
  if (!ficha) return null;
  const parts = [...ficha.name.matchAll(/(\d+)-([a-z]+)/g)].map(
    (m) => `${m[1]}% ${MATERIAL_LABELS[m[2]] || m[2].toUpperCase()}`
  );
  return parts.length ? parts.join(" · ") : null;
}

function detectFit(name: string): "oversized" | "regular" {
  return /oversized/i.test(name) ? "oversized" : "regular";
}

function detectFabric(name: string): "dry" | "algodao" {
  return /\bdry\b/i.test(name) ? "dry" : "algodao";
}

// Cores comuns do catálogo Bulking; a query do cliente ("preto") casa com o
// token no nome do produto ("PRETA"/"PRETO").
const COLOR_TOKENS: Record<string, string[]> = {
  preto: ["preta", "preto", "black"],
  branco: ["branca", "branco", "off white", "off-white", "white"],
  cinza: ["cinza", "chumbo", "mescla", "grafite"],
  azul: ["azul", "marinho", "navy", "royal"],
  verde: ["verde", "militar", "oliva"],
  vermelho: ["vermelha", "vermelho", "bordo", "bordô", "vinho"],
  bege: ["bege", "areia", "off", "cru", "caqui"],
  marrom: ["marrom", "caramelo", "chocolate", "terra"],
  rosa: ["rosa", "pink"],
  amarelo: ["amarela", "amarelo", "mostarda"],
  roxo: ["roxa", "roxo", "lilas", "lilás"],
  laranja: ["laranja"],
};

function matchesColor(name: string, colorQuery: string): boolean {
  const n = name.toLowerCase();
  const q = colorQuery
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const tokens = COLOR_TOKENS[q] || [q];
  return tokens.some((t) => n.includes(t));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function toSummary(row: ShelfProductRow): AssistantProductSummary {
  return {
    id: String(row.product_id),
    name: row.name,
    url: row.product_url || "",
    image_url: row.image_url,
    price: row.price !== null ? Number(row.price) : null,
    sale_price: row.sale_price !== null ? Number(row.sale_price) : null,
    available: row.in_stock !== false,
    fit: detectFit(row.name),
    fabric: detectFabric(row.name),
    composition: parseFichaTecnica(row.tags),
  };
}

// --- Busca no catálogo (espelho local) ---

export interface CatalogSearchOptions {
  query?: string;
  color?: string;
  fabric?: "dry" | "algodao";
  fit?: "oversized" | "regular";
  maxPrice?: number;
  limit?: number;
}

export async function searchCatalog(
  workspaceId: string,
  opts: CatalogSearchOptions
): Promise<AssistantProductSummary[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shelf_products")
    .select(SELECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .limit(600);

  const rows = (data || []) as ShelfProductRow[];
  const limit = Math.min(Math.max(opts.limit || 6, 1), 10);

  // Kits são combos — o assistente recomenda peças individuais
  let candidates = rows.filter((r) => !/\bkit\b/i.test(r.name));

  if (opts.color) {
    candidates = candidates.filter((r) => matchesColor(r.name, opts.color!));
  }
  if (opts.fabric) {
    candidates = candidates.filter((r) => detectFabric(r.name) === opts.fabric);
  }
  if (opts.fit) {
    candidates = candidates.filter((r) => detectFit(r.name) === opts.fit);
  }
  if (opts.maxPrice && Number.isFinite(opts.maxPrice)) {
    candidates = candidates.filter((r) => {
      const effective = r.sale_price !== null ? Number(r.sale_price) : Number(r.price);
      return Number.isFinite(effective) && effective <= opts.maxPrice!;
    });
  }

  // Ranking simples por tokens da busca no nome (todas as palavras contam,
  // match parcial vale menos). Sem busca → mantém a ordem do catálogo.
  if (opts.query && opts.query.trim()) {
    const tokens = normalize(opts.query).split(/\s+/).filter((t) => t.length > 1);
    const scored = candidates
      .map((r) => {
        const name = normalize(r.name);
        let score = 0;
        for (const t of tokens) {
          if (name.includes(t)) score += 2;
        }
        return { r, score };
      })
      .filter((s) => s.score > 0 || tokens.length === 0);
    scored.sort((a, b) => b.score - a.score);
    candidates = scored.map((s) => s.r);
  }

  // Disponíveis primeiro
  candidates.sort((a, b) => Number(b.in_stock !== false) - Number(a.in_stock !== false));

  return candidates.slice(0, limit).map(toSummary);
}

// --- Detalhe de produto (espelho + variantes ao vivo) ---

interface VndaVariantRaw {
  id?: number;
  sku?: string;
  name?: string;
  available?: boolean;
  stock?: number;
  quantity?: number;
  balance?: number;
  available_quantity?: number;
  properties?: Record<string, { name?: string; value?: string } | null>;
}

// Variantes podem vir embrulhadas: [{ "123": {...} }] (mesmo comportamento
// tratado em vnda-api.ts — helpers de lá são privados, replicados aqui).
function unwrapVariant(v: unknown): VndaVariantRaw {
  if (
    v &&
    typeof v === "object" &&
    !("sku" in v) &&
    !("name" in v) &&
    !("available" in v)
  ) {
    const nested = Object.values(v as Record<string, unknown>)[0];
    if (nested && typeof nested === "object") return nested as VndaVariantRaw;
  }
  return (v || {}) as VndaVariantRaw;
}

function variantHasStock(v: VndaVariantRaw): boolean {
  if (v.available === false) return false;
  const candidates = [v.quantity, v.balance, v.available_quantity, v.stock];
  for (const c of candidates) {
    if (c !== undefined && c !== null && Number.isFinite(Number(c))) {
      return Number(c) > 0;
    }
  }
  // Sem campo de estoque → confia no flag available (≠ false, já checado acima)
  return true;
}

const SIZE_TOKEN = /\b(PP|P|M|G|GG|XGG|EGG|EG|XG|3G|4G|U)\b/;

function extractSize(v: VndaVariantRaw): string | null {
  if (v.properties && typeof v.properties === "object") {
    for (const p of Object.values(v.properties)) {
      if (p && /taman/i.test(String(p.name || "")) && p.value) {
        return String(p.value).toUpperCase().trim();
      }
    }
  }
  for (const field of [v.name, v.sku]) {
    if (field) {
      const m = String(field).toUpperCase().match(SIZE_TOKEN);
      if (m) return m[1];
    }
  }
  return null;
}

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XGG", "EG", "EGG", "XG", "3G", "4G", "U"];

/** Um tamanho está disponível se QUALQUER variante dele tiver estoque. */
function variantsToSizes(variants: unknown[]): AssistantSizeAvailability[] {
  const bySize = new Map<string, boolean>();
  for (const raw of variants) {
    const v = unwrapVariant(raw);
    const size = extractSize(v);
    if (!size) continue;
    bySize.set(size, (bySize.get(size) || false) || variantHasStock(v));
  }
  return [...bySize.entries()]
    .sort((a, b) => SIZE_ORDER.indexOf(a[0]) - SIZE_ORDER.indexOf(b[0]))
    .map(([size, available]) => ({ size, available }));
}

async function fetchProductDetail(
  config: VndaConfig,
  productId: string
): Promise<{ variants: unknown[]; description: string | null } | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiToken}`,
    Accept: "application/json",
  };
  const urls = [
    `https://${config.storeHost}/api/v2/products/${encodeURIComponent(productId)}`,
    `https://api.vnda.com.br/api/v2/products/${encodeURIComponent(productId)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: url.includes("api.vnda.com.br")
          ? { ...headers, "X-Shop-Host": config.storeHost }
          : headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        variants?: unknown[];
        description?: string;
      };
      return {
        variants: Array.isArray(json?.variants) ? json.variants : [],
        description: sanitizeDescription(json?.description),
      };
    } catch {
      // tenta próxima URL; falha total → null (widget segue funcionando)
    }
  }
  return null;
}

function sanitizeDescription(html: unknown): string | null {
  if (typeof html !== "string" || !html.trim()) return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 700) : null;
}

export async function getProductDetails(
  workspaceId: string,
  productId: string
): Promise<AssistantProductDetails | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shelf_products")
    .select(SELECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("product_id", String(productId))
    .maybeSingle();

  if (!data) return null;
  const row = data as ShelfProductRow;
  const summary = toSummary(row);

  let sizes: AssistantSizeAvailability[] = [];
  let description: string | null = null;
  try {
    const config = await getVndaConfigAdmin(workspaceId);
    if (config) {
      const detail = await fetchProductDetail(config, String(productId));
      if (detail) {
        description = detail.description;
        sizes = variantsToSizes(detail.variants);
      }
    }
  } catch {
    // VNDA fora do ar → devolve o que temos do espelho
  }

  return { ...summary, description, sizes };
}
