import { createAdminClient } from "@/lib/supabase-admin";
import {
  getYourViewsConfig,
  iterateAllReviews,
  type YourViewsConfig,
  type YvReview,
} from "@/lib/reviews/yourviews-api";

// Extração em massa da Yourviews → tabela `reviews`, INTEGRADA com a VNDA.
//
// Cada review da Yourviews é resolvido contra o catálogo da loja
// (`shelf_products`, o mesmo usado por prateleiras/etiquetas) para:
//   1. Vincular ao produto CERTO da VNDA — o product_id gravado é sempre o id
//      canônico da VNDA (`shelf_products.product_id`, o mesmo que o widget lê na
//      PDP). Assim nunca aparece avaliação de um produto em outro.
//   2. Descartar produtos que não existem mais na VNDA (ids "old_...", etc.).
//   3. Por padrão, manter só produtos ATIVOS (configurável).
//
// Idempotente: upsert ON CONFLICT (workspace_id, source, external_id) DO NOTHING.

export type ProductFilter = "active" | "known" | "all";

export interface ReviewRow {
  workspace_id: string;
  source: string;
  external_id: string;
  product_id: string | null;
  product_name: string | null;
  product_url: string | null;
  product_image: string | null;
  product_sku: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  author_name: string | null;
  author_email: string | null;
  verified_buyer: boolean;
  reference_order: string | null;
  custom_fields: { name: string; values: string[] }[];
  media: { url: string; type: "image" | "video" }[];
  likes: number;
  dislikes: number;
  status: string;
  reviewed_at: string | null;
}

function clampRating(r: number | undefined | null): number {
  const n = Number(r);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, Math.round(n)));
}

// Normaliza URL de foto: Yourviews manda protocol-relative ("//host/...").
function normalizePhotoUrl(raw: string): string | null {
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("//")) s = "https:" + s;
  else if (s.startsWith("http://")) s = s.replace(/^http:/, "https:");
  return /^https:\/\//i.test(s) ? s : null;
}

// CustomerPhotos vem como array de strings (URLs) ou de objetos.
function mapPhotos(photos: YvReview["CustomerPhotos"]): ReviewRow["media"] {
  if (!Array.isArray(photos)) return [];
  const out: ReviewRow["media"] = [];
  for (const p of photos) {
    let url: string | null = null;
    if (typeof p === "string") {
      url = normalizePhotoUrl(p);
    } else if (p && typeof p === "object") {
      const cand = p.Url || p.Original || p.ImageUrl || p.Thumbnail || p.Thumb;
      if (typeof cand === "string") url = normalizePhotoUrl(cand);
    }
    if (url) out.push({ url, type: "image" });
  }
  return out;
}

function mapCustomFields(fields: YvReview["CustomFields"]): ReviewRow["custom_fields"] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && f.Name && Array.isArray(f.Values) && f.Values.length > 0)
    .map((f) => ({ name: f.Name, values: f.Values }));
}

function parseDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Normaliza nome de produto pra matching de fallback (sem acento/pontuação).
export function normName(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Converte uma avaliação crua da Yourviews numa linha de `reviews` (sem resolver produto). */
export function mapYourViewsReview(workspaceId: string, r: YvReview): ReviewRow {
  return {
    workspace_id: workspaceId,
    source: "yourviews",
    external_id: String(r.ReviewId),
    product_id: r.Product?.ProductId ? String(r.Product.ProductId) : null,
    product_name: r.Product?.Name ?? null,
    product_url: r.Product?.Url ?? null,
    product_image: r.Product?.Image ?? null,
    product_sku: r.Product?.Sku ?? null,
    rating: clampRating(r.Rating),
    title: r.Title ?? r.ReviewTitle ?? null,
    body: r.Review ?? null,
    author_name: r.User?.Name ?? null,
    author_email: r.User?.Email ?? null,
    verified_buyer: Boolean(r.BoughtProduct),
    reference_order: r.ReferenceOrder ?? null,
    custom_fields: mapCustomFields(r.CustomFields),
    media: mapPhotos(r.CustomerPhotos),
    likes: Number(r.Likes) || 0,
    dislikes: Number(r.Dislikes) || 0,
    status: "published",
    reviewed_at: parseDate(r.Date),
  };
}

// --- Índice do catálogo VNDA (shelf_products), paginado (passa de 1000). ---

interface CatProd {
  product_id: string;
  name: string | null;
  image_url: string | null;
  product_url: string | null;
  active: boolean;
}

export interface CatalogIndex {
  byId: Map<string, CatProd>;
  byName: Map<string, CatProd>;
  total: number;
  active: number;
}

export async function loadCatalogIndex(
  workspaceId: string,
  admin = createAdminClient()
): Promise<CatalogIndex> {
  const all: CatProd[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("shelf_products")
      .select("product_id, name, image_url, product_url, active")
      .eq("workspace_id", workspaceId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`shelf_products: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as CatProd[]));
    if (data.length < PAGE) break;
  }

  const byId = new Map<string, CatProd>();
  const byName = new Map<string, CatProd>();
  for (const p of all) {
    if (p.product_id) byId.set(String(p.product_id), p);
    const n = normName(p.name);
    if (n && !byName.has(n)) byName.set(n, p);
  }
  return { byId, byName, total: all.length, active: all.filter((p) => p.active).length };
}

// Resolve um review ao produto VNDA. Retorna o CatProd casado (ou null).
function resolveProduct(row: ReviewRow, index: CatalogIndex): CatProd | null {
  if (row.product_id && index.byId.has(row.product_id)) return index.byId.get(row.product_id)!;
  const n = normName(row.product_name);
  if (n && index.byName.has(n)) return index.byName.get(n)!;
  return null;
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  pages: number;
  matched: number;
  skipped_unknown: number;   // produto não existe na VNDA
  skipped_inactive: number;  // existe mas está inativo (filtro 'active')
  with_photos: number;
  errors: string[];
}

export interface SyncOptions {
  config?: YourViewsConfig | null;
  dateFrom?: string;
  count?: number;
  maxPages?: number;
  productFilter?: ProductFilter;  // default 'active'
  reset?: boolean;                // apaga source='yourviews' antes
  onProgress?: (msg: string) => void;
}

const BATCH = 500;

export async function syncYourViewsReviews(
  workspaceId: string,
  opts: SyncOptions = {}
): Promise<SyncResult> {
  const admin = createAdminClient();
  const onProgress = opts.onProgress ?? (() => {});
  const filter: ProductFilter = opts.productFilter ?? "active";
  const result: SyncResult = {
    fetched: 0, inserted: 0, pages: 0, matched: 0,
    skipped_unknown: 0, skipped_inactive: 0, with_photos: 0, errors: [],
  };

  const config = opts.config ?? (await getYourViewsConfig(workspaceId));
  if (!config) {
    throw new Error("Credenciais da Yourviews não configuradas (yourviews_connections ou env YOURVIEWS_*).");
  }

  // Índice do catálogo VNDA (a menos que filter='all').
  let index: CatalogIndex | null = null;
  if (filter !== "all") {
    index = await loadCatalogIndex(workspaceId, admin);
    onProgress(`Catálogo VNDA: ${index.total} produtos (${index.active} ativos).`);
    if (index.total === 0) {
      throw new Error("Catálogo VNDA (shelf_products) vazio. Sincronize o catálogo das prateleiras antes de importar avaliações.");
    }
  }

  if (opts.reset) {
    const { error } = await admin.from("reviews").delete().eq("workspace_id", workspaceId).eq("source", "yourviews");
    if (error) result.errors.push(`reset: ${error.message}`);
    else onProgress("Avaliações antigas (source=yourviews) apagadas.");
  }

  await admin
    .from("yourviews_connections")
    .update({ last_sync_status: "running", last_sync_message: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);

  let buffer: ReviewRow[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const seen = new Set<string>();
    const rows = buffer.filter((r) => {
      if (seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });
    buffer = [];
    const { data, error } = await admin
      .from("reviews")
      .upsert(rows, { onConflict: "workspace_id,source,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      result.errors.push(error.message);
      onProgress(`Erro ao gravar lote: ${error.message}`);
    } else {
      result.inserted += data?.length ?? 0;
    }
  };

  try {
    for await (const raw of iterateAllReviews(config, {
      count: opts.count ?? 50,
      dateFrom: opts.dateFrom,
      maxPages: opts.maxPages,
      onPage: (page, items) => {
        result.pages = page;
        onProgress(`Página ${page}: ${items.length} lidas (total ${result.fetched + items.length}, vinculadas ${result.matched})`);
      },
    })) {
      result.fetched++;
      const row = mapYourViewsReview(workspaceId, raw);

      if (index) {
        const prod = resolveProduct(row, index);
        if (!prod) { result.skipped_unknown++; continue; }
        if (filter === "active" && !prod.active) { result.skipped_inactive++; continue; }
        // Canonicaliza pro id/dados da VNDA (vínculo correto + frescos).
        row.product_id = prod.product_id;
        row.product_name = prod.name ?? row.product_name;
        row.product_image = prod.image_url ?? row.product_image;
        row.product_url = prod.product_url ?? row.product_url;
      }

      result.matched++;
      if (row.media.length > 0) result.with_photos++;
      buffer.push(row);
      if (buffer.length >= BATCH) await flush();
    }
    await flush();

    await admin
      .from("yourviews_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: result.errors.length ? "error" : "ok",
        last_sync_message: result.errors.length
          ? result.errors.join("; ").slice(0, 500)
          : `${result.inserted} novas de ${result.matched} vinculadas (${result.fetched} lidas; ${result.skipped_unknown} fora da VNDA, ${result.skipped_inactive} inativas)`,
        total_imported: result.inserted,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await flush().catch(() => {});
    await admin
      .from("yourviews_connections")
      .update({ last_sync_status: "error", last_sync_message: msg.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
    throw err;
  }

  return result;
}
