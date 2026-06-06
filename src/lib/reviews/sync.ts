import { createAdminClient } from "@/lib/supabase-admin";
import {
  getYourViewsConfig,
  iterateAllReviews,
  type YourViewsConfig,
  type YvReview,
} from "@/lib/reviews/yourviews-api";

// Extração em massa da Yourviews → tabela `reviews`. Idempotente: o upsert é
// ON CONFLICT (workspace_id, source, external_id) DO NOTHING, então re-rodar a
// carga só insere o que faltava e nunca sobrescreve moderação local.

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

function mapPhotos(photos: YvReview["CustomerPhotos"]): ReviewRow["media"] {
  if (!Array.isArray(photos)) return [];
  const out: ReviewRow["media"] = [];
  for (const p of photos) {
    const url = p?.Url || p?.Original || p?.Thumbnail || p?.Thumb;
    if (url) out.push({ url, type: "image" });
  }
  return out;
}

function mapCustomFields(
  fields: YvReview["CustomFields"]
): ReviewRow["custom_fields"] {
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

/** Converte uma avaliação crua da Yourviews numa linha de `reviews`. */
export function mapYourViewsReview(
  workspaceId: string,
  r: YvReview
): ReviewRow {
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

export interface SyncResult {
  fetched: number;
  inserted: number;
  pages: number;
  errors: string[];
}

export interface SyncOptions {
  config?: YourViewsConfig | null;
  dateFrom?: string;
  count?: number;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

const BATCH = 500;

/**
 * Extrai todas as avaliações da Yourviews (paginadas) e insere em `reviews`.
 * Atualiza o estado da sincronização em yourviews_connections.
 */
export async function syncYourViewsReviews(
  workspaceId: string,
  opts: SyncOptions = {}
): Promise<SyncResult> {
  const admin = createAdminClient();
  const onProgress = opts.onProgress ?? (() => {});
  const result: SyncResult = { fetched: 0, inserted: 0, pages: 0, errors: [] };

  const config = opts.config ?? (await getYourViewsConfig(workspaceId));
  if (!config) {
    throw new Error(
      "Credenciais da Yourviews não configuradas (yourviews_connections ou env YOURVIEWS_*)."
    );
  }

  await admin
    .from("yourviews_connections")
    .update({ last_sync_status: "running", last_sync_message: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);

  // Acumula em lotes e dá flush a cada BATCH.
  let buffer: ReviewRow[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    // Dedup por external_id dentro do lote (evita conflito no mesmo INSERT).
    const seen = new Set<string>();
    const rows = buffer.filter((r) => {
      if (seen.has(r.external_id)) return false;
      seen.add(r.external_id);
      return true;
    });
    buffer = [];

    const { data, error } = await admin
      .from("reviews")
      .upsert(rows, {
        onConflict: "workspace_id,source,external_id",
        ignoreDuplicates: true,
      })
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
        onProgress(`Página ${page}: ${items.length} avaliações (total ${result.fetched + items.length})`);
      },
    })) {
      result.fetched++;
      buffer.push(mapYourViewsReview(workspaceId, raw));
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
          : `${result.inserted} novas de ${result.fetched} avaliações`,
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
      .update({
        last_sync_status: "error",
        last_sync_message: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);
    throw err;
  }

  return result;
}
