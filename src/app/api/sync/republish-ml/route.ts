import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import type { HubProduct } from "@/types/hub";

export const maxDuration = 120;

/**
 * POST — Close existing ML items and re-publish with a different listing type.
 * ML API does not support changing listing_type_id via PUT, so we must
 * close the old item and create a new one via push-ml.
 *
 * Body: { skus: string[], listing_type_id: string }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const skus: string[] = body.skus || [];
  const listingTypeId: string = body.listing_type_id;

  if (skus.length === 0 || !listingTypeId) {
    return NextResponse.json(
      { error: "skus e listing_type_id obrigatorios" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Fetch all products in the group
  const { data: products, error: fetchErr } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("sku", skus);

  if (fetchErr || !products?.length) {
    return NextResponse.json(
      { error: fetchErr?.message || "Nenhum produto encontrado" },
      { status: 404 }
    );
  }

  const hubProducts = products as HubProduct[];

  // Collect all unique ml_item_ids that need to be closed
  const itemsToClose = new Set<string>();
  for (const p of hubProducts) {
    if (p.ml_item_id) itemsToClose.add(p.ml_item_id);
  }

  if (itemsToClose.size === 0) {
    return NextResponse.json(
      { error: "Nenhum produto publicado no ML para republicar" },
      { status: 400 }
    );
  }

  // Step 1: Close all existing ML items
  const closeErrors: Array<{ ml_item_id: string; error: string }> = [];
  for (const mlItemId of itemsToClose) {
    try {
      await ml.put(
        `/items/${mlItemId}`,
        { status: "closed" },
        workspaceId
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao fechar anuncio";
      closeErrors.push({ ml_item_id: mlItemId, error: message });
    }
  }

  if (closeErrors.length > 0) {
    // Log close errors but continue — items may already be closed
    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "republish_ml",
      entity: "product",
      entity_id: skus[0],
      direction: "hub_to_ml",
      status: "error",
      details: { step: "close", errors: closeErrors },
    });
  }

  // Step 2: Clear ML fields on all products in the group
  const allSkus = hubProducts.map((p) => p.sku);

  // Also find children that may share parent's ml_item_id
  const parentSkus = hubProducts.filter((p) => !p.ecc_pai_sku).map((p) => p.sku);
  if (parentSkus.length > 0) {
    const { data: children } = await supabase
      .from("hub_products")
      .select("sku, ml_item_id")
      .eq("workspace_id", workspaceId)
      .in("ecc_pai_sku", parentSkus)
      .not("ml_item_id", "is", null);

    if (children) {
      for (const child of children) {
        if (child.ml_item_id && !itemsToClose.has(child.ml_item_id)) {
          // Close this child's ML item too
          try {
            await ml.put(`/items/${child.ml_item_id}`, { status: "closed" }, workspaceId);
          } catch { /* may already be closed */ }
        }
        if (!allSkus.includes(child.sku)) allSkus.push(child.sku);
      }
    }
  }

  // Clear ML fields for all products
  const { error: clearErr } = await supabase
    .from("hub_products")
    .update({
      ml_item_id: null,
      ml_permalink: null,
      ml_status: null,
      ml_variation_id: null,
      ml_preco: null,
      ml_estoque: null,
      ml_data: null,
      sync_status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .in("sku", allSkus);

  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  // Step 3: Re-publish via push-ml internally
  // Find category from enrichment (should still be there since we didn't clear ml_enrichment)
  const categoryId = hubProducts.find((p) => p.ml_enrichment?.category_id)?.ml_enrichment?.category_id;

  if (!categoryId) {
    // Products cleared but can't re-publish without category
    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "republish_ml",
      entity: "product",
      entity_id: skus[0],
      direction: "hub_to_ml",
      status: "ok",
      details: {
        step: "closed_only",
        closed: Array.from(itemsToClose),
        listing_type_id: listingTypeId,
        message: "Items fechados mas sem category_id para republicar. Use Publicar.",
      },
    });

    return NextResponse.json({
      closed: itemsToClose.size,
      republished: 0,
      message: "Anuncios fechados. Use o botao Publicar para republicar com a nova categoria.",
    });
  }

  // Call push-ml as internal fetch
  const pushBody = {
    skus: allSkus,
    category_id: categoryId,
    listing_type_id: listingTypeId,
  };

  const origin = req.nextUrl.origin;
  const pushRes = await fetch(`${origin}/api/sync/push-ml`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify(pushBody),
  });

  const pushData = await pushRes.json();

  // Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "republish_ml",
    entity: "product",
    entity_id: skus[0],
    direction: "hub_to_ml",
    status: pushRes.ok ? "ok" : "error",
    details: {
      closed: Array.from(itemsToClose),
      listing_type_id: listingTypeId,
      category_id: categoryId,
      push_result: pushData,
    },
  });

  return NextResponse.json({
    closed: itemsToClose.size,
    republished: pushData.published ?? 0,
    errors: pushData.errors ?? 0,
    results: pushData.results,
  });
}
