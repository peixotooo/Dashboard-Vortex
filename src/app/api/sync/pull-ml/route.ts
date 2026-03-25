import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";

export const maxDuration = 120;

interface MLPicture {
  url: string;
  secure_url?: string;
}

interface MLItem {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  permalink: string;
  category_id: string;
  seller_custom_field?: string;
  pictures?: MLPicture[];
  variations?: Array<{
    id: number;
    seller_sku?: string;
    price: number;
    available_quantity: number;
    attribute_combinations?: Array<{ id: string; value_name: string }>;
    picture_ids?: string[];
  }>;
}

/** Extract best quality URL from ML picture (prefer HTTPS secure_url) */
function picUrl(pic: MLPicture): string {
  return pic.secure_url || pic.url;
}

/**
 * GET — List seller's active items on Mercado Livre.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status") || "active";
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
  const limit = 50;

  try {
    // Get ML user ID
    const user = await ml.get<{ id: number }>("/users/me", workspaceId);

    // Search user's items
    const search = await ml.get<{
      results: string[];
      paging: { total: number; offset: number; limit: number };
    }>(
      `/users/${user.id}/items/search?status=${status}&offset=${offset}&limit=${limit}`,
      workspaceId
    );

    const itemIds = search.results || [];
    if (itemIds.length === 0) {
      return NextResponse.json({ items: [], total: search.paging?.total ?? 0, hasMore: false });
    }

    // Fetch details for each item (batch via multi-get)
    // ML supports GET /items?ids=MLB1,MLB2,... (up to 20 at a time)
    const items: MLItem[] = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const batchResult = await ml.get<Array<{ code: number; body: MLItem }>>(
        `/items?ids=${batch.join(",")}`,
        workspaceId
      );
      if (Array.isArray(batchResult)) {
        items.push(...batchResult.filter((r) => r.code === 200).map((r) => r.body));
      }
    }

    // Check which are already in hub
    const mlItemIds = items.map((item) => item.id);
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("hub_products")
      .select("ml_item_id")
      .eq("workspace_id", workspaceId)
      .in("ml_item_id", mlItemIds);

    const existingIds = new Set((existing || []).map((r) => r.ml_item_id));

    const result = items.map((item) => {
      // Collect SKUs: seller_custom_field + all variation seller_skus
      const skus: string[] = [];
      if (item.seller_custom_field) skus.push(item.seller_custom_field);
      if (item.variations) {
        for (const v of item.variations) {
          if (v.seller_sku && !skus.includes(v.seller_sku)) {
            skus.push(v.seller_sku);
          }
        }
      }

      return {
        ml_item_id: item.id,
        title: item.title,
        price: item.price,
        quantity: item.available_quantity,
        status: item.status,
        permalink: item.permalink,
        category_id: item.category_id,
        sku: item.seller_custom_field || null,
        skus,
        thumbnail: item.pictures?.[0] ? picUrl(item.pictures[0]) : null,
        photos_count: item.pictures?.length || 0,
        variations_count: item.variations?.length || 0,
        already_in_hub: existingIds.has(item.id),
      };
    });

    return NextResponse.json({
      items: result,
      total: search.paging?.total ?? 0,
      hasMore: offset + limit < (search.paging?.total ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST — Import selected ML items into the hub.
 * Body: { item_ids: ["MLB1374737433"] }
 *
 * For items WITH variations:
 *   - Creates a parent row (ml_variation_id = null, ecc_pai_sku = null)
 *   - Creates child rows per variation (ecc_pai_sku = parent SKU)
 *
 * For items WITHOUT variations:
 *   - Creates a single row with preco + estoque filled
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const itemIds: string[] = body.item_ids || [];

  if (itemIds.length === 0) {
    return NextResponse.json(
      { error: "item_ids (array) obrigatorio" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  let imported = 0;
  let linked = 0;
  const errors: Array<{ item_id: string; error: string }> = [];
  const now = new Date().toISOString();

  for (const itemId of itemIds) {
    try {
      const item = await ml.get<MLItem>(`/items/${itemId}`, workspaceId);

      const fotos = (item.pictures || []).map((p) => picUrl(p)).filter(Boolean);

      if (item.variations && item.variations.length > 0) {
        // ---------------------------------------------------------------
        // Product WITH variations → parent row + child rows
        // ---------------------------------------------------------------

        // Determine parent SKU (must not collide with any variation SKU)
        const variationSkus = new Set(
          item.variations.map((v) => v.seller_sku).filter(Boolean)
        );
        let parentSku = item.seller_custom_field || `ML-${item.id}`;
        if (variationSkus.has(parentSku)) {
          parentSku = `ML-${item.id}`;
        }

        const totalEstoque = item.variations.reduce(
          (sum, v) => sum + (v.available_quantity || 0),
          0
        );

        // Check linking for parent
        const { data: parentLink } = await supabase
          .from("hub_products")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("sku", parentSku)
          .eq("source", "eccosys")
          .single();
        const parentLinked = !!parentLink;
        if (parentLinked) linked++;

        // Upsert parent row
        await supabase.from("hub_products").upsert(
          {
            workspace_id: workspaceId,
            sku: parentSku,
            nome: item.title,
            preco: item.price,
            estoque: totalEstoque,
            fotos,
            ml_item_id: item.id,
            ml_variation_id: null,
            ml_category_id: item.category_id,
            ml_status: item.status,
            ml_permalink: item.permalink,
            ml_preco: item.price,
            ml_estoque: totalEstoque,
            ecc_pai_sku: null,
            source: "ml" as const,
            linked: parentLinked,
            sync_status: "synced" as const,
            last_ml_sync: now,
            updated_at: now,
          },
          { onConflict: "workspace_id,sku" }
        );
        imported++;

        // Upsert child rows
        for (const variation of item.variations) {
          const childSku =
            variation.seller_sku || `ML-${item.id}-${variation.id}`;

          const atributos: Record<string, string> = {};
          for (const attr of variation.attribute_combinations || []) {
            atributos[attr.id.toLowerCase()] = attr.value_name;
          }

          // Build descriptive name: "Title — Cor: Azul, Tamanho: G"
          const attrLabel = Object.values(atributos).join(", ");
          const childNome = attrLabel
            ? `${item.title} — ${attrLabel}`
            : item.title;

          const { data: childLink } = await supabase
            .from("hub_products")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("sku", childSku)
            .eq("source", "eccosys")
            .single();
          const childLinked = !!childLink;
          if (childLinked) linked++;

          await supabase.from("hub_products").upsert(
            {
              workspace_id: workspaceId,
              sku: childSku,
              nome: childNome,
              preco: variation.price,
              estoque: variation.available_quantity,
              fotos,
              atributos,
              ecc_pai_sku: parentSku,
              ml_item_id: item.id,
              ml_variation_id: variation.id,
              ml_category_id: item.category_id,
              ml_status: item.status,
              ml_permalink: item.permalink,
              ml_preco: variation.price,
              ml_estoque: variation.available_quantity,
              source: "ml" as const,
              linked: childLinked,
              sync_status: "synced" as const,
              last_ml_sync: now,
              updated_at: now,
            },
            { onConflict: "workspace_id,sku" }
          );
          imported++;
        }
      } else {
        // ---------------------------------------------------------------
        // Simple product — single row with preco + estoque
        // ---------------------------------------------------------------
        const sku = item.seller_custom_field || `ML-${item.id}`;

        const { data: existingBySku } = await supabase
          .from("hub_products")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("sku", sku)
          .eq("source", "eccosys")
          .single();

        const isLinked = !!existingBySku;
        if (isLinked) linked++;

        await supabase.from("hub_products").upsert(
          {
            workspace_id: workspaceId,
            sku,
            nome: item.title,
            preco: item.price,
            estoque: item.available_quantity,
            fotos,
            ml_item_id: item.id,
            ml_category_id: item.category_id,
            ml_status: item.status,
            ml_permalink: item.permalink,
            ml_preco: item.price,
            ml_estoque: item.available_quantity,
            source: "ml" as const,
            linked: isLinked,
            sync_status: "synced" as const,
            last_ml_sync: now,
            updated_at: now,
          },
          { onConflict: "workspace_id,sku" }
        );

        imported++;
      }

      // Log
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "pull_ml",
        entity: "product",
        entity_id: itemId,
        direction: "ml_to_hub",
        status: "ok",
        details: {
          title: item.title,
          variations: item.variations?.length || 0,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ item_id: itemId, error: message });

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "pull_ml",
        entity: "product",
        entity_id: itemId,
        direction: "ml_to_hub",
        status: "error",
        details: { error: message },
      });
    }
  }

  return NextResponse.json({ imported, linked, errors });
}
