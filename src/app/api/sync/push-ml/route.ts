import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import type { HubProduct } from "@/types/hub";

export const maxDuration = 120;

interface PushResult {
  sku: string;
  status: "published" | "error";
  ml_item_id?: string;
  ml_permalink?: string;
  error?: string;
}

// -------------------------------------------------------------------
// Build ML payload for a simple product (no variations)
// -------------------------------------------------------------------
function buildSimplePayload(
  product: HubProduct,
  categoryId: string
) {
  return {
    title: (product.nome || product.sku).substring(0, 60),
    category_id: categoryId,
    price: Number(product.preco),
    currency_id: "BRL",
    available_quantity: product.estoque,
    buying_mode: "buy_it_now",
    listing_type_id: "gold_special",
    condition: "new",
    description: { plain_text: product.descricao || product.nome || "" },
    pictures: (product.fotos || []).map((url) => ({ source: url })),
    seller_custom_field: product.sku,
    attributes: [
      { id: "BRAND", value_name: "Bulking" },
      ...(product.gtin ? [{ id: "GTIN", value_name: product.gtin }] : []),
    ],
    shipping: {
      mode: "me2",
      local_pick_up: false,
      free_shipping: false,
      ...(product.largura && product.altura && product.comprimento && product.peso
        ? {
            dimensions: `${product.altura}x${product.largura}x${product.comprimento},${(product.peso * 1000).toFixed(0)}`,
          }
        : {}),
    },
    sale_terms: [
      { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
      { id: "WARRANTY_TIME", value_name: "90 dias" },
    ],
  };
}

// -------------------------------------------------------------------
// Build ML payload for a product with variations (parent + children)
// -------------------------------------------------------------------
function buildVariationPayload(
  parent: HubProduct,
  children: HubProduct[],
  categoryId: string
) {
  // Collect all unique photos from children
  const allPhotos = [...new Set(children.flatMap((c) => c.fotos || []))];

  return {
    title: (parent.nome || parent.sku).substring(0, 60),
    category_id: categoryId,
    price: Number(parent.preco || children[0]?.preco || 0),
    currency_id: "BRL",
    buying_mode: "buy_it_now",
    listing_type_id: "gold_special",
    condition: "new",
    description: { plain_text: parent.descricao || parent.nome || "" },
    pictures: allPhotos.map((url) => ({ source: url })),
    seller_custom_field: parent.sku,
    attributes: [{ id: "BRAND", value_name: "Bulking" }],
    variations: children.map((child) => ({
      available_quantity: child.estoque,
      price: Number(child.preco || parent.preco || 0),
      seller_sku: child.sku,
      picture_ids: [],
      attribute_combinations: Object.entries(child.atributos || {}).map(
        ([key, val]) => ({
          id: key.toUpperCase(),
          value_name: String(val),
        })
      ),
    })),
    shipping: {
      mode: "me2",
      local_pick_up: false,
      free_shipping: false,
    },
    sale_terms: [
      { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
      { id: "WARRANTY_TIME", value_name: "90 dias" },
    ],
  };
}

/**
 * POST — Publish selected hub products to Mercado Livre.
 * Body: { skus: string[], category_id: string, validate_only?: boolean }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const skus: string[] = body.skus || [];
  const categoryId: string = body.category_id;
  const validateOnly: boolean = body.validate_only === true;

  if (skus.length === 0 || !categoryId) {
    return NextResponse.json(
      { error: "skus (array) e category_id sao obrigatorios" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Fetch all requested products from hub
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

  // Group by ecc_pai_sku to identify variation families
  // Products with null ecc_pai_sku are simple
  // Products with same ecc_pai_sku form a variation group
  const simpleProducts: HubProduct[] = [];
  const variationGroups = new Map<string, HubProduct[]>();

  for (const p of hubProducts) {
    // Skip products already published to ML
    if (p.ml_item_id) continue;

    if (p.ecc_pai_sku) {
      const group = variationGroups.get(p.ecc_pai_sku) || [];
      group.push(p);
      variationGroups.set(p.ecc_pai_sku, group);
    } else {
      simpleProducts.push(p);
    }
  }

  const results: PushResult[] = [];

  // -------------------------------------------------------------------
  // Publish simple products
  // -------------------------------------------------------------------
  for (const product of simpleProducts) {
    try {
      const payload = buildSimplePayload(product, categoryId);

      if (validateOnly) {
        await ml.post("/items/validate", payload, workspaceId);
        results.push({ sku: product.sku, status: "published" });
        continue;
      }

      const result = await ml.post<{
        id: string;
        permalink: string;
        status: string;
      }>("/items", payload, workspaceId);

      // Update hub_products with ML data
      await supabase
        .from("hub_products")
        .update({
          ml_item_id: result.id,
          ml_permalink: result.permalink,
          ml_status: result.status,
          ml_preco: Number(product.preco),
          ml_estoque: product.estoque,
          sync_status: "synced",
          last_ml_sync: new Date().toISOString(),
          error_msg: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      // Log success
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "ok",
        details: {
          ml_item_id: result.id,
          ml_permalink: result.permalink,
        },
      });

      results.push({
        sku: product.sku,
        status: "published",
        ml_item_id: result.id,
        ml_permalink: result.permalink,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";

      // Update hub_products with error
      await supabase
        .from("hub_products")
        .update({
          sync_status: "error",
          error_msg: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "error",
        details: { error: message },
      });

      results.push({ sku: product.sku, status: "error", error: message });
    }
  }

  // -------------------------------------------------------------------
  // Publish variation groups
  // -------------------------------------------------------------------
  for (const [paiSku, children] of variationGroups) {
    try {
      // Find parent product (may or may not be in the selection)
      let parent: HubProduct | undefined;
      const { data: parentData } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("sku", paiSku)
        .single();

      parent = parentData as HubProduct | undefined;

      // If no parent row, use first child as base
      if (!parent) {
        parent = children[0];
      }

      const payload = buildVariationPayload(parent, children, categoryId);

      if (validateOnly) {
        await ml.post("/items/validate", payload, workspaceId);
        children.forEach((c) =>
          results.push({ sku: c.sku, status: "published" })
        );
        continue;
      }

      const result = await ml.post<{
        id: string;
        permalink: string;
        status: string;
        variations: Array<{ id: number; seller_sku: string }>;
      }>("/items", payload, workspaceId);

      // Update parent product
      if (parentData) {
        await supabase
          .from("hub_products")
          .update({
            ml_item_id: result.id,
            ml_permalink: result.permalink,
            ml_status: result.status,
            sync_status: "synced",
            last_ml_sync: new Date().toISOString(),
            error_msg: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", parent.id);
      }

      // Update each child with variation_id
      for (const child of children) {
        const mlVariation = result.variations?.find(
          (v) => v.seller_sku === child.sku
        );

        await supabase
          .from("hub_products")
          .update({
            ml_item_id: result.id,
            ml_variation_id: mlVariation?.id || null,
            ml_permalink: result.permalink,
            ml_status: result.status,
            sync_status: "synced",
            last_ml_sync: new Date().toISOString(),
            error_msg: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", child.id);

        results.push({
          sku: child.sku,
          status: "published",
          ml_item_id: result.id,
          ml_permalink: result.permalink,
        });
      }

      // Log success
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: paiSku,
        direction: "hub_to_ml",
        status: "ok",
        details: {
          ml_item_id: result.id,
          variation_count: children.length,
          skus: children.map((c) => c.sku),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";

      // Mark all children as error
      for (const child of children) {
        await supabase
          .from("hub_products")
          .update({
            sync_status: "error",
            error_msg: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", child.id);

        results.push({ sku: child.sku, status: "error", error: message });
      }

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: paiSku,
        direction: "hub_to_ml",
        status: "error",
        details: {
          error: message,
          skus: children.map((c) => c.sku),
        },
      });
    }
  }

  const published = results.filter((r) => r.status === "published").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    published,
    errors,
    validate_only: validateOnly,
    results,
  });
}
