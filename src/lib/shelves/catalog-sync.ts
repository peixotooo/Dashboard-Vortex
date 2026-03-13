import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";

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
    position: number;
  }>;
  created_at?: string;
  updated_at?: string;
}

interface SyncResult {
  synced: number;
  errors: number;
  total: number;
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

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < vndaProducts.length; i += batchSize) {
      const batch = vndaProducts.slice(i, i + batchSize);
      const rows = batch.map((p) => mapVndaProduct(p, workspaceId, config.storeHost));

      const { error } = await admin.from("shelf_products").upsert(rows, {
        onConflict: "workspace_id,product_id",
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
  const row = mapVndaProduct(productData, workspaceId, storeHost);

  await admin.from("shelf_products").upsert(row, {
    onConflict: "workspace_id,product_id",
    ignoreDuplicates: false,
  });
}

// --- Map VNDA product to shelf_products row ---

function mapVndaProduct(
  p: VndaProduct,
  workspaceId: string,
  storeHost: string
) {
  // Get images sorted by position
  const sortedImages = (p.images || []).sort(
    (a, b) => a.position - b.position
  );

  const imageUrl = sortedImages[0]?.url || p.image_url || null;
  const imageUrl2 = sortedImages[1]?.url || null;

  // Determine stock status from variants
  const hasStock =
    p.available !== false &&
    (p.variants || []).some((v) => v.available !== false);

  // Build tags from category_tags and tag_names
  const tags = [...(p.category_tags || []), ...(p.tag_names || [])];

  return {
    workspace_id: workspaceId,
    product_id: String(p.id),
    sku: p.sku || p.reference || null,
    name: p.name,
    category: p.category_name || null,
    tags: tags.length > 0 ? tags : [],
    price: p.price,
    sale_price: p.on_sale && p.sale_price ? p.sale_price : null,
    image_url: imageUrl,
    image_url_2: imageUrl2,
    product_url: `https://${storeHost}/produto/${p.slug}`,
    active: p.available !== false,
    in_stock: hasStock,
    created_at: p.created_at || new Date().toISOString(),
    updated_at: p.updated_at || new Date().toISOString(),
  };
}
