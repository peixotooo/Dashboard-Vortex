import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";

export const maxDuration = 120;

interface MLItem {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  permalink: string;
  category_id: string;
  seller_custom_field?: string;
  pictures?: Array<{ url: string }>;
  variations?: Array<{
    id: number;
    seller_sku?: string;
    price: number;
    available_quantity: number;
    attribute_combinations?: Array<{ id: string; value_name: string }>;
  }>;
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

    const result = items.map((item) => ({
      ml_item_id: item.id,
      title: item.title,
      price: item.price,
      quantity: item.available_quantity,
      status: item.status,
      permalink: item.permalink,
      category_id: item.category_id,
      sku: item.seller_custom_field || null,
      thumbnail: item.pictures?.[0]?.url || null,
      variations_count: item.variations?.length || 0,
      already_in_hub: existingIds.has(item.id),
    }));

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

  for (const itemId of itemIds) {
    try {
      const item = await ml.get<MLItem>(`/items/${itemId}`, workspaceId);

      const fotos = (item.pictures || []).map((p) => p.url).filter(Boolean);

      if (item.variations && item.variations.length > 0) {
        // One row per variation
        for (const variation of item.variations) {
          const sku =
            variation.seller_sku ||
            item.seller_custom_field ||
            `ML-${item.id}-${variation.id}`;

          const atributos: Record<string, string> = {};
          for (const attr of variation.attribute_combinations || []) {
            atributos[attr.id.toLowerCase()] = attr.value_name;
          }

          // Check if SKU exists in hub (for linking)
          const { data: existingBySku } = await supabase
            .from("hub_products")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("sku", sku)
            .eq("source", "eccosys")
            .single();

          const isLinked = !!existingBySku;
          if (isLinked) linked++;

          const row = {
            workspace_id: workspaceId,
            ml_item_id: item.id,
            ml_variation_id: variation.id,
            ml_category_id: item.category_id,
            ml_status: item.status,
            ml_permalink: item.permalink,
            ml_preco: variation.price,
            ml_estoque: variation.available_quantity,
            nome: item.title,
            sku,
            fotos,
            atributos,
            source: "ml" as const,
            linked: isLinked,
            sync_status: "synced" as const,
            last_ml_sync: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await supabase
            .from("hub_products")
            .upsert(row, { onConflict: "workspace_id,sku" });

          imported++;
        }
      } else {
        // Simple product — one row
        const sku =
          item.seller_custom_field || `ML-${item.id}`;

        const { data: existingBySku } = await supabase
          .from("hub_products")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("sku", sku)
          .eq("source", "eccosys")
          .single();

        const isLinked = !!existingBySku;
        if (isLinked) linked++;

        const row = {
          workspace_id: workspaceId,
          ml_item_id: item.id,
          ml_category_id: item.category_id,
          ml_status: item.status,
          ml_permalink: item.permalink,
          ml_preco: item.price,
          ml_estoque: item.available_quantity,
          nome: item.title,
          sku,
          fotos,
          source: "ml" as const,
          linked: isLinked,
          sync_status: "synced" as const,
          last_ml_sync: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from("hub_products")
          .upsert(row, { onConflict: "workspace_id,sku" });

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
        details: { title: item.title, variations: item.variations?.length || 0 },
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
