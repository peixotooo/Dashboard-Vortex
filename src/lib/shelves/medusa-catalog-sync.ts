import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchAllMedusaProducts,
  getMedusaEnv,
  type MedusaEnv,
  type MedusaProduct,
} from "@/lib/shelves/medusa-api";
import { shelfSourceColumnsAvailable } from "@/lib/shelves/source";

/**
 * Sync do catálogo Medusa → shelf_products (source='medusa').
 *
 * Identidade: product_id = metadata.vnda_id (o MESMO id numérico VNDA usado
 * pela linha vnda, por widgets/reviews/promo). Produto sem vnda_id é pulado
 * e contado — nunca inventamos identidade.
 *
 * Paralelo de verdade: nunca toca nas linhas source='vnda'.
 */

export interface MedusaShelfRow {
  workspace_id: string;
  source: "medusa";
  product_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  tags: unknown[];
  price: number;
  sale_price: number | null;
  image_url: string | null;
  image_url_2: string | null;
  product_url: string;
  active: boolean;
  in_stock: boolean;
  created_at: string;
  updated_at: string;
}

export interface MedusaSyncResult {
  synced: number;
  errors: number;
  skippedNoVndaId: number;
  total: number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function variantInStock(v: {
  inventory_quantity?: number | null;
  manage_inventory?: boolean | null;
  allow_backorder?: boolean | null;
}): boolean {
  if (v.manage_inventory === false) return true;
  if (v.allow_backorder === true) return true;
  return (v.inventory_quantity ?? 0) > 0;
}

export function mapMedusaProduct(
  p: MedusaProduct,
  workspaceId: string,
  storefrontUrl: string
): MedusaShelfRow | null {
  const vndaId = asNumber(p.metadata?.vnda_id);
  if (vndaId === null) return null;

  const variants = p.variants || [];

  // Preço efetivo = menor calculated_price entre variantes (prioriza em estoque).
  const pool = variants.filter((v) => variantInStock(v));
  const priced = (pool.length > 0 ? pool : variants)
    .map((v) => ({
      calculated: asNumber(v.calculated_price?.calculated_amount),
      original: asNumber(v.calculated_price?.original_amount),
      compareAt: asNumber(v.metadata?.compare_at),
    }))
    .filter((v) => v.calculated !== null);

  const effective =
    priced.length > 0
      ? Math.min(...priced.map((v) => v.calculated as number))
      : null;
  if (effective === null) return null; // sem preço não vai pra prateleira

  // "De/por": compare_at (preço cheio VNDA migrado) ou original_amount maior.
  const compareCandidates = priced
    .map((v) => Math.max(v.compareAt ?? 0, v.original ?? 0))
    .filter((n) => n > effective);
  const compareAt = compareCandidates.length > 0 ? Math.max(...compareCandidates) : null;

  const price = compareAt ?? effective;
  const salePrice = compareAt !== null ? effective : null;

  // Imagens ordenadas por rank; hover = segunda imagem.
  const images = [...(p.images || [])]
    .filter((img) => !!img.url)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const imageUrl = images[0]?.url || p.thumbnail || null;
  const imageUrl2 =
    images.map((img) => img.url as string).find((url) => url !== imageUrl) || null;

  // Categoria: primeira categoria ativa não-interna (por rank), nome de exibição
  // igual ao lado VNDA ('Camisetas'), pra régua/engine continuar casando.
  const category =
    [...(p.categories || [])]
      .filter((c) => c.is_internal !== true && c.is_active !== false && (c.name || c.handle))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0] || null;

  // Tags: preserva o vocabulário VNDA (metadata.vnda_tag_details), que é o que
  // custom_tags/combo_tag/engine leem. Fallback: categorias Medusa.
  const vndaTagDetails = Array.isArray(p.metadata?.vnda_tag_details)
    ? (p.metadata?.vnda_tag_details as unknown[])
    : [];
  const tags: unknown[] =
    vndaTagDetails.length > 0
      ? vndaTagDetails
      : (p.categories || [])
          .filter((c) => c.handle || c.name)
          .map((c) => ({ name: c.handle || c.name, type: "product_category", title: c.name }));

  const sku =
    (typeof p.metadata?.vnda_reference === "string" && p.metadata.vnda_reference) ||
    variants.find((v) => v.sku)?.sku?.replace(/-\d+$/, "") ||
    null;

  const inStock = variants.some((v) => variantInStock(v));

  return {
    workspace_id: workspaceId,
    source: "medusa",
    product_id: String(vndaId),
    sku,
    name: p.title,
    category: category?.name || category?.handle || null,
    tags,
    price,
    sale_price: salePrice,
    image_url: imageUrl,
    image_url_2: imageUrl2,
    product_url: `${storefrontUrl}/br/products/${p.handle}`,
    active: p.status ? p.status === "published" : true,
    in_stock: inStock,
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || new Date().toISOString(),
  };
}

/** Busca + mapeia tudo (sem tocar no banco) — usado pelo sync e por dry-runs. */
export async function fetchMedusaShelfRows(
  workspaceId: string,
  env?: MedusaEnv | null
): Promise<{ rows: MedusaShelfRow[]; skippedNoVndaId: number; total: number }> {
  const medusaEnv = env ?? getMedusaEnv();
  if (!medusaEnv) {
    throw new Error("Medusa not configured (MEDUSA_BACKEND_URL / MEDUSA_PUBLISHABLE_KEY)");
  }

  const products = await fetchAllMedusaProducts(medusaEnv);
  const rows: MedusaShelfRow[] = [];
  let skippedNoVndaId = 0;

  for (const p of products) {
    const row = mapMedusaProduct(p, workspaceId, medusaEnv.storefrontUrl);
    if (row) rows.push(row);
    else if (asNumber(p.metadata?.vnda_id) === null) skippedNoVndaId++;
  }

  if (skippedNoVndaId > 0) {
    console.warn(
      `[MedusaCatalogSync] ${skippedNoVndaId}/${products.length} produtos sem metadata.vnda_id — pulados`
    );
  }

  return { rows, skippedNoVndaId, total: products.length };
}

/** Sync completo Medusa → shelf_products. Exige migration-143 aplicada. */
export async function syncMedusaCatalog(workspaceId: string): Promise<MedusaSyncResult> {
  const admin = createAdminClient();

  if (!(await shelfSourceColumnsAvailable())) {
    throw new Error(
      "shelf_products.source not available yet (migration-143 pending) — medusa sync skipped"
    );
  }

  const { data: logRow } = await admin
    .from("shelf_sync_logs")
    .insert({
      workspace_id: workspaceId,
      status: "in_progress",
      products_synced: 0,
      source: "medusa",
    })
    .select("id")
    .single();

  try {
    const { rows, skippedNoVndaId, total } = await fetchMedusaShelfRows(workspaceId);

    let synced = 0;
    let errors = 0;

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await admin.from("shelf_products").upsert(batch, {
        onConflict: "workspace_id,product_id,source",
        ignoreDuplicates: false,
      });

      if (error) {
        console.error("[MedusaCatalogSync] Batch error:", error.message);
        errors += batch.length;
      } else {
        synced += batch.length;
      }
    }

    if (logRow?.id) {
      await admin
        .from("shelf_sync_logs")
        .update({
          status: errors > 0 ? "partial" : "success",
          products_synced: synced,
          error_message:
            [
              errors > 0 ? `${errors} products failed` : null,
              skippedNoVndaId > 0 ? `${skippedNoVndaId} sem vnda_id` : null,
            ]
              .filter(Boolean)
              .join("; ") || null,
        })
        .eq("id", logRow.id);
    }

    return { synced, errors, skippedNoVndaId, total };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (logRow?.id) {
      await admin
        .from("shelf_sync_logs")
        .update({ status: "error", error_message: message })
        .eq("id", logRow.id);
    }

    throw error;
  }
}
