import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import {
  indexEccosysStocks,
  normalizeEccosysStockQuantity,
} from "@/lib/eccosys/stock";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 300;

/**
 * POST — Sync stock from Eccosys to ML for linked products.
 * Body: { workspace_id: "..." } (or from x-workspace-id header)
 */
export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(req));
  } catch (error) {
    return handleAuthError(error);
  }

  const supabase = createAdminClient();

  // Fetch linked products that have both Eccosys SKU and ML item
  // Exclude sob_demanda products (stock managed manually in Hub, not from Eccosys)
  const { data: products, error } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .not("ecc_id", "is", null)
    .not("ml_item_id", "is", null)
    .eq("sync_status", "synced")
    .eq("sob_demanda", false);

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
    const allStocks = await eccosys.listStockBulk<EccosysEstoque>(workspaceId);
    const indexedStocks = indexEccosysStocks(allStocks);
    for (const [sku, stock] of indexedStocks.bySku) {
      eccStockMap.set(sku, normalizeEccosysStockQuantity(stock.estoqueDisponivel));
    }
    for (const [productId, stock] of indexedStocks.byProductId) {
      eccIdStockMap.set(productId, normalizeEccosysStockQuantity(stock.estoqueDisponivel));
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
      if (row.ecc_id && eccIdStockMap.has(row.ecc_id)) {
        // Prefer the exact product link when Eccosys has duplicate SKU codes.
        newStock = eccIdStockMap.get(row.ecc_id)!;
      } else if (eccStockMap.has(row.sku)) {
        newStock = eccStockMap.get(row.sku)!;
      } else if (!bulkFetch) {
        const estoque = await eccosys.get<EccosysEstoque>(
          `/estoques/${encodeURIComponent(row.sku)}`,
          workspaceId
        );
        newStock = normalizeEccosysStockQuantity(estoque.estoqueDisponivel);
      } else {
        throw new Error("SKU nao encontrado no snapshot em lote do Eccosys");
      }

      // Validate stock value
      newStock = normalizeEccosysStockQuantity(newStock);

      const desiredMlStock = newStock <= 0 ? 0 : newStock;
      const shouldPause = newStock <= 0 && !row.ml_variation_id;
      const stockChanged = desiredMlStock !== row.ml_estoque || (shouldPause && row.ml_status !== "paused") || (newStock > 0 && row.ml_status === "paused");

      if (!stockChanged) {
        skipped++;
        continue;
      }

      if (shouldPause) {
        await ml.put(`/items/${row.ml_item_id}`, { available_quantity: 0, status: "paused" }, workspaceId);
      } else if (row.ml_variation_id) {
        await ml.put(
          `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
          { available_quantity: desiredMlStock },
          workspaceId
        );
      } else {
        const payload: Record<string, unknown> = { available_quantity: desiredMlStock };
        if (row.ml_status === "paused") payload.status = "active";
        await ml.put(`/items/${row.ml_item_id}`, payload, workspaceId);
      }

      // Update hub
      const now = new Date().toISOString();
      await supabase
        .from("hub_products")
        .update({
          estoque: newStock,
          ml_estoque: desiredMlStock,
          ml_status: shouldPause ? "paused" : row.ml_status === "paused" && newStock > 0 ? "active" : row.ml_status,
          last_ecc_sync: now,
          last_ml_sync: now,
          updated_at: now,
        })
        .eq("id", row.id);

      // Log per-product stock change
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "sync_stock",
        entity: "product",
        entity_id: row.ml_item_id,
        direction: "eccosys_to_ml",
        status: "ok",
        details: {
          sku: row.sku,
          ml_variation_id: row.ml_variation_id || null,
          old_stock: row.estoque,
          new_stock: newStock,
          old_ml_stock: row.ml_estoque,
          new_ml_stock: desiredMlStock,
          paused: shouldPause,
          reactivated: row.ml_status === "paused" && newStock > 0,
        },
      });

      updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ sku: row.sku, error: message });

      // Log per-product error
      try {
        await supabase.from("hub_logs").insert({
          workspace_id: workspaceId,
          action: "sync_stock",
          entity: "product",
          entity_id: row.ml_item_id,
          direction: "eccosys_to_ml",
          status: "error",
          details: { sku: row.sku, error: message },
        });
      } catch { /* ignore log failure */ }
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
