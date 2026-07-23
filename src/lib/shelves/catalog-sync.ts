import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import {
  normalizeShelfImageUrl,
  pickShelfImages,
  shelfImageKey,
  type VndaCatalogImage,
} from "@/lib/shelves/image-utils";
import { shelfSourceColumnsAvailable } from "@/lib/shelves/source";

// Depois da migration-143 a UNIQUE de shelf_products passa a incluir `source`
// (linhas vnda e medusa do mesmo produto coexistem). O sync VNDA é tolerante à
// ordem de deploy: com as colunas no banco usa a chave nova e carimba
// source='vnda'; sem elas, comporta-se exatamente como antes.
async function vndaUpsertOptions(): Promise<{
  onConflict: string;
  withSource: boolean;
}> {
  const hasSource = await shelfSourceColumnsAvailable();
  return hasSource
    ? { onConflict: "workspace_id,product_id,source", withSource: true }
    : { onConflict: "workspace_id,product_id", withSource: false };
}

// --- Types ---

interface VndaProduct {
  id: number;
  name: string;
  slug: string;
  sku?: string;
  reference?: string;
  price: number;
  sale_price?: number | null;
  on_sale?: boolean;
  available: boolean;
  image_url?: string;
  description?: string;
  category_name?: string;
  category_tags?: string[];
  tag_names?: string[];
  variants?: Array<{
    sku?: string;
    name?: string;
    price: number;
    sale_price?: number | null;
    available: boolean;
    stock?: number;
  }>;
  images?: Array<{
    url: string;
    position?: number | null;
    id?: number | null;
    updated_at?: string | null;
  }>;
  created_at?: string;
  updated_at?: string;
}

interface SyncResult {
  synced: number;
  errors: number;
  total: number;
}

interface ExistingShelfImages {
  image_url: string | null;
  image_url_2: string | null;
}

// --- Get VNDA config using admin client (no cookies needed) ---

async function getVndaConfigAdmin(workspaceId: string) {
  const admin = createAdminClient();

  const { data } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (data?.api_token && data?.store_host) {
    return {
      apiToken: decrypt(data.api_token),
      storeHost: data.store_host as string,
    };
  }

  // Fallback to env vars
  const token = process.env.VNDA_API_TOKEN;
  const host = process.env.VNDA_STORE_HOST;
  if (token && host) {
    return { apiToken: token, storeHost: host };
  }

  return null;
}

// --- Fetch all products from VNDA with pagination ---

async function fetchAllVndaProducts(
  apiToken: string,
  storeHost: string
): Promise<VndaProduct[]> {
  const allProducts: VndaProduct[] = [];
  let page = 1;
  const maxPages = 100;

  while (page <= maxPages) {
    const url = new URL("https://api.vnda.com.br/api/v2/products");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "200");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "X-Shop-Host": storeHost,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`VNDA Products API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data: VndaProduct[] = await res.json();
    allProducts.push(...data);

    // Check pagination
    const paginationHeader = res.headers.get("X-Pagination");
    if (paginationHeader) {
      try {
        const pagination = JSON.parse(paginationHeader);
        if (!pagination.next_page || page >= pagination.total_pages) break;
      } catch {
        break;
      }
    } else if (data.length < 200) {
      break;
    }

    page++;
  }

  return allProducts;
}

async function fetchVndaProductImages(
  apiToken: string,
  storeHost: string,
  productId: number | string
): Promise<VndaCatalogImage[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(
        `https://api.vnda.com.br/api/v2/products/${encodeURIComponent(String(productId))}/images`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: "application/json",
            "X-Shop-Host": storeHost,
          },
          signal: controller.signal,
        }
      );

      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[CatalogSync] Images API ${res.status} product ${productId}: ${text.slice(0, 120)}`
        );
        return [];
      }

      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as VndaCatalogImage[]) : [];
    } catch (err) {
      console.warn(
        `[CatalogSync] Images API failed product ${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  console.warn(`[CatalogSync] Images API rate-limited product ${productId}`);
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasDistinctHoverImage(primaryImage: string | null | undefined, hoverImage: string | null | undefined): boolean {
  return !!hoverImage && shelfImageKey(hoverImage) !== shelfImageKey(primaryImage);
}

function shouldFetchGalleryImages(product: VndaProduct, existing?: ExistingShelfImages): boolean {
  if (product.available === false) return false;
  const primaryImage = product.image_url || existing?.image_url || null;
  if (hasDistinctHoverImage(primaryImage, existing?.image_url_2)) return false;
  const picked = pickShelfImages({
    primaryImage,
    images: product.images || [],
  });
  if (hasDistinctHoverImage(picked.imageUrl, picked.imageUrl2)) return false;
  return true;
}

async function loadExistingImages(
  workspaceId: string,
  productIds: string[]
): Promise<Map<string, ExistingShelfImages>> {
  if (productIds.length === 0) return new Map();

  const admin = createAdminClient();
  let query = admin
    .from("shelf_products")
    .select("product_id, image_url, image_url_2")
    .eq("workspace_id", workspaceId)
    .in("product_id", productIds);
  if (await shelfSourceColumnsAvailable()) {
    query = query.eq("source", "vnda");
  }
  const { data } = await query;

  const map = new Map<string, ExistingShelfImages>();
  for (const row of data ?? []) {
    map.set(String(row.product_id), {
      image_url: (row.image_url as string | null) ?? null,
      image_url_2: (row.image_url_2 as string | null) ?? null,
    });
  }
  return map;
}

async function mapProductsWithImages(
  products: VndaProduct[],
  workspaceId: string,
  config: { apiToken: string; storeHost: string },
  concurrency = 3
) {
  const rows: ReturnType<typeof mapVndaProduct>[] = new Array(products.length);
  const existingById = await loadExistingImages(
    workspaceId,
    products.map((product) => String(product.id))
  );
  let cursor = 0;

  async function worker() {
    while (cursor < products.length) {
      const index = cursor++;
      const product = products[index];
      const existing = existingById.get(String(product.id));
      const galleryImages = shouldFetchGalleryImages(product, existing)
        ? await fetchVndaProductImages(config.apiToken, config.storeHost, product.id)
        : product.images;
      rows[index] = mapVndaProduct(
        product,
        workspaceId,
        config.storeHost,
        galleryImages,
        existing?.image_url_2
      );
      if (galleryImages && galleryImages.length > 0) await sleep(120);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, products.length) }, () => worker())
  );

  return rows;
}

// --- Main sync function ---

export async function syncCatalog(workspaceId: string): Promise<SyncResult> {
  const admin = createAdminClient();

  // Log sync start
  const { data: logRow } = await admin
    .from("shelf_sync_logs")
    .insert({
      workspace_id: workspaceId,
      status: "in_progress",
      products_synced: 0,
    })
    .select("id")
    .single();

  try {
    const config = await getVndaConfigAdmin(workspaceId);
    if (!config) {
      throw new Error("VNDA not configured for this workspace");
    }

    const vndaProducts = await fetchAllVndaProducts(
      config.apiToken,
      config.storeHost
    );

    let synced = 0;
    let errors = 0;

    const upsertOptions = await vndaUpsertOptions();

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < vndaProducts.length; i += batchSize) {
      const batch = vndaProducts.slice(i, i + batchSize);
      const mapped = await mapProductsWithImages(batch, workspaceId, config);
      const rows = upsertOptions.withSource
        ? mapped.map((row) => ({ ...row, source: "vnda" }))
        : mapped;

      const { error } = await admin.from("shelf_products").upsert(rows, {
        onConflict: upsertOptions.onConflict,
        ignoreDuplicates: false,
      });

      if (error) {
        console.error("[CatalogSync] Batch error:", error.message);
        errors += batch.length;
      } else {
        synced += batch.length;
      }
    }

    // Update sync log
    if (logRow?.id) {
      await admin
        .from("shelf_sync_logs")
        .update({
          status: errors > 0 ? "partial" : "success",
          products_synced: synced,
          error_message: errors > 0 ? `${errors} products failed` : null,
        })
        .eq("id", logRow.id);
    }

    return { synced, errors, total: vndaProducts.length };
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

// --- Sync a single product (for webhook) ---

export async function syncSingleProduct(
  workspaceId: string,
  productData: VndaProduct,
  storeHost: string
): Promise<void> {
  const admin = createAdminClient();
  const existingById = await loadExistingImages(workspaceId, [String(productData.id)]);
  const existing = existingById.get(String(productData.id));
  const config = await getVndaConfigAdmin(workspaceId);
  const galleryImages = config && shouldFetchGalleryImages(productData, existing)
    ? await fetchVndaProductImages(config.apiToken, config.storeHost || storeHost, productData.id)
    : productData.images;
  const row = mapVndaProduct(
    productData,
    workspaceId,
    storeHost,
    galleryImages,
    existing?.image_url_2
  );

  const upsertOptions = await vndaUpsertOptions();
  await admin
    .from("shelf_products")
    .upsert(upsertOptions.withSource ? { ...row, source: "vnda" } : row, {
      onConflict: upsertOptions.onConflict,
      ignoreDuplicates: false,
    });
}

// --- Map VNDA product to shelf_products row ---

function mapVndaProduct(
  p: VndaProduct,
  workspaceId: string,
  storeHost: string,
  galleryImages?: VndaCatalogImage[],
  existingImageUrl2?: string | null
) {
  const { imageUrl, imageUrl2 } = pickShelfImages({
    primaryImage: p.image_url,
    images: galleryImages || p.images || [],
  });
  const existingHover = hasDistinctHoverImage(imageUrl, existingImageUrl2)
    ? normalizeShelfImageUrl(existingImageUrl2)
    : null;

  // Determine stock status from variants
  const hasStock =
    p.available !== false &&
    (p.variants || []).some((v) => v.available !== false);

  // Build tags from category_tags and tag_names
  const tags: any[] = [...((p as any).category_tags || []), ...((p as any).tag_names || [])];

  // Try to find a reliable category
  let category = p.category_name || null;
  if (!category && Array.isArray(tags)) {
    const catTag = tags.find((t) => 
      t && typeof t === "object" && (t.tag_type === "product_category" || t.type === "product_category")
    );
    if (catTag && catTag.name) {
      category = catTag.name;
    }
  }

  return {
    workspace_id: workspaceId,
    product_id: String(p.id),
    sku: p.sku || p.reference || null,
    name: p.name,
    category: category,
    tags: tags.length > 0 ? tags : [],
    price: p.price,
    sale_price: p.on_sale && p.sale_price ? p.sale_price : null,
    image_url: imageUrl,
    image_url_2: imageUrl2 || existingHover,
    product_url: `https://${storeHost}/produto/${p.slug}`,
    active: p.available !== false,
    in_stock: hasStock,
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || new Date().toISOString(),
  };
}
