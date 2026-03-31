import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 300;

/**
 * POST — Sync stock from Eccosys to ML for linked products.
 * Body: { workspace_id: "..." } (or from x-workspace-id header)
 */
export async function POST(req: NextRequest) {
  const workspaceId =
    req.headers.get("x-workspace-id") ||
    ((await req.json().catch(() => ({}))) as Record<string, string>)
      .workspace_id;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Fetch linked products that have both Eccosys SKU and ML item
  const { data: products, error } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .not("ecc_id", "is", null)
    .not("ml_item_id", "is", null)
    .eq("sync_status", "synced");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!products || products.length === 0) {
    return NextResponse.json({ updated: 0, message: "Nenhum produto vinculado" });
  }

  // Skip parent rows that have children (children sync individually)
  const parentSkusWithChildren = new Set<string>();
  const mlItemsWithVariations = new Set<string>();
  for (const p of products as HubProduct[]) {
    if (p.ecc_pai_sku) parentSkusWithChildren.add(p.ecc_pai_sku);
    if (p.ml_variation_id && p.ml_item_id) mlItemsWithVariations.add(p.ml_item_id);
  }
  const syncableProducts = (products as HubProduct[]).filter((p) => {
    if (!p.ecc_pai_sku && parentSkusWithChildren.has(p.sku)) return false;
    // Also skip ML parents whose children sync individually (when SKU != Eccosys SKU)
    if (!p.ml_variation_id && p.ml_item_id && mlItemsWithVariations.has(p.ml_item_id)) return false;
    return true;
  });

  let updated = 0;
  let skipped = 0;
  const errors: Array<{ sku: string; error: string }> = [];

  // Fetch ALL stocks in bulk to avoid per-SKU requests
  let bulkFetch = false;
  const eccStockMap = new Map<string, number>();
  const eccIdStockMap = new Map<number, number>(); // ecc_id → stock (for multi-linked products)
  try {
    const allStocks = await eccosys.listAll<EccosysEstoque>(
      "/estoques",
      workspaceId,
      undefined,
      100
    );
    for (const es of allStocks) {
      eccStockMap.set(es.codigo, es.estoqueDisponivel);
      if (es.idProduto) eccIdStockMap.set(parseInt(es.idProduto), es.estoqueDisponivel);
    }
    bulkFetch = true;
    console.log(`[sync-stock] Bulk fetch OK: ${eccStockMap.size} SKUs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[sync-stock] Bulk fetch FALHOU: ${msg} — usando fallback per-SKU`);
    errors.push({ sku: "_bulk", error: `bulk_fetch_failed: ${msg}` });
  }

  for (const row of syncableProducts) {
    try {
      // Get current Eccosys stock (from bulk map, ecc_id map, or individual fallback)
      let newStock: number;
      if (eccStockMap.has(row.sku)) {
        newStock = eccStockMap.get(row.sku)!;
      } else if (row.ecc_id && eccIdStockMap.has(row.ecc_id)) {
        // Fallback: lookup by ecc_id (for products linked to same Eccosys item with ML SKU)
        newStock = eccIdStockMap.get(row.ecc_id)!;
      } else {
        const estoque = await eccosys.get<EccosysEstoque>(
          `/estoques/${encodeURIComponent(row.sku)}`,
          workspaceId
        );
        newStock = estoque.estoqueDisponivel;
      }

      // ML requires available_quantity >= 1
      const mlStock = Math.max(newStock, 1);

      // Compare with current ML stock
      if (mlStock === row.ml_estoque) {
        skipped++;
        continue;
      }

      // Update ML
      if (row.ml_variation_id) {
        await ml.put(
          `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
          { available_quantity: mlStock },
          workspaceId
        );
      } else {
        await ml.put(
          `/items/${row.ml_item_id}`,
          { available_quantity: mlStock },
          workspaceId
        );
      }

      // Update hub
      await supabase
        .from("hub_products")
        .update({
          estoque: newStock,
          ml_estoque: mlStock,
          last_ecc_sync: new Date().toISOString(),
          last_ml_sync: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ sku: row.sku, error: message });
    }
  }

  // Log summary
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "sync_stock",
    entity: "product",
    entity_id: null,
    direction: "eccosys_to_ml",
    status: errors.filter((e) => e.sku !== "_bulk").length > 0 ? "error" : "ok",
    details: {
      total: syncableProducts.length,
      updated,
      skipped,
      bulk_fetch: bulkFetch,
      errors: errors.length,
      error_details: errors.slice(0, 20),
    },
  });

  return NextResponse.json({ updated, skipped, errors });
}
