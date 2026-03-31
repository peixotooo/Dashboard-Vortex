import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 300;

/**
 * GET — Cron: Sync stock from Eccosys to ML for all workspaces.
 * Price is managed in Hub and pushed to ML from there — not synced from Eccosys.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results: Array<{
    workspace_id: string;
    total: number;
    stock_updated: number;
    skipped: number;
    errors: number;
    error_details?: string[];
    bulk_fetch: boolean;
  }> = [];

  // Find workspaces with both Eccosys and ML connected
  const { data: connections } = await supabase
    .from("eccosys_connections")
    .select("workspace_id");

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: "No workspaces", results: [] });
  }

  for (const conn of connections) {
    const wsId = conn.workspace_id;
    const wsResult = {
      workspace_id: wsId,
      total: 0,
      stock_updated: 0,
      skipped: 0,
      errors: 0,
      error_details: [] as string[],
      bulk_fetch: false,
    };

    try {
      // Check if ML is connected for this workspace
      const mlConnected = await ml.isConnected(wsId);
      if (!mlConnected) {
        results.push(wsResult);
        continue;
      }

      // Fetch products with both Eccosys and ML links (= "Vinculado")
      const { data: products } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", wsId)
        .not("ecc_id", "is", null)
        .not("ml_item_id", "is", null)
        .eq("sync_status", "synced");

      if (!products || products.length === 0) {
        results.push(wsResult);
        continue;
      }

      // Build set of parent SKUs that have children — skip parents in sync
      // to avoid overwriting child stock (UP model: parent shares ml_item_id with one child)
      const parentSkusWithChildren = new Set<string>();
      const mlItemsWithVariations = new Set<string>();
      for (const p of products as HubProduct[]) {
        if (p.ecc_pai_sku) parentSkusWithChildren.add(p.ecc_pai_sku);
        if (p.ml_variation_id && p.ml_item_id) mlItemsWithVariations.add(p.ml_item_id);
      }

      const syncableProducts = (products as HubProduct[]).filter((p) => {
        // Skip parent rows that have children (children sync individually)
        if (!p.ecc_pai_sku && parentSkusWithChildren.has(p.sku)) return false;
        // Also skip ML parents whose children sync individually (when SKU != Eccosys SKU)
        if (!p.ml_variation_id && p.ml_item_id && mlItemsWithVariations.has(p.ml_item_id)) return false;
        return true;
      });

      wsResult.total = syncableProducts.length;

      // Fetch ALL Eccosys stock in bulk to avoid per-SKU requests
      const eccStockMap = new Map<string, number>();
      const eccIdStockMap = new Map<number, number>(); // ecc_id → stock (for multi-linked products)
      try {
        const allStocks = await eccosys.listAll<EccosysEstoque>(
          "/estoques",
          wsId,
          undefined,
          100
        );
        for (const es of allStocks) {
          eccStockMap.set(es.codigo, es.estoqueDisponivel);
          if (es.idProduto) eccIdStockMap.set(parseInt(es.idProduto), es.estoqueDisponivel);
        }
        wsResult.bulk_fetch = true;
        console.log(`[sync-stock] Bulk fetch OK: ${eccStockMap.size} SKUs para workspace ${wsId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        console.error(`[sync-stock] Bulk fetch FALHOU para workspace ${wsId}: ${msg} — usando fallback per-SKU`);
        wsResult.error_details.push(`bulk_fetch_failed: ${msg}`);
      }

      const now = new Date().toISOString();

      for (const row of syncableProducts) {
        try {
          // --- Stock sync ---
          let newStock: number;
          if (eccStockMap.has(row.sku)) {
            newStock = eccStockMap.get(row.sku)!;
          } else if (row.ecc_id && eccIdStockMap.has(row.ecc_id)) {
            // Fallback: lookup by ecc_id (for products linked to same Eccosys item with ML SKU)
            newStock = eccIdStockMap.get(row.ecc_id)!;
          } else {
            // Fallback: individual request if bulk didn't include this SKU
            const estoque = await eccosys.get<EccosysEstoque>(
              `/estoques/${encodeURIComponent(row.sku)}`,
              wsId
            );
            newStock = estoque.estoqueDisponivel;
          }
          // ML requires available_quantity >= 1
          const mlStock = Math.max(newStock, 1);
          const stockChanged = mlStock !== row.ml_estoque;

          if (stockChanged) {
            if (row.ml_variation_id) {
              await ml.put(
                `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
                { available_quantity: mlStock },
                wsId
              );
            } else {
              await ml.put(
                `/items/${row.ml_item_id}`,
                { available_quantity: mlStock },
                wsId
              );
            }
            wsResult.stock_updated++;
          }

          // --- Update hub_products ---
          if (stockChanged) {
            await supabase
              .from("hub_products")
              .update({
                estoque: newStock,
                ml_estoque: mlStock,
                last_ecc_sync: now,
                last_ml_sync: now,
                updated_at: now,
              })
              .eq("id", row.id);
          } else {
            wsResult.skipped++;
          }
        } catch (err) {
          wsResult.errors++;
          const msg = err instanceof Error ? err.message : "Erro desconhecido";
          wsResult.error_details.push(`${row.sku}: ${msg}`);
          console.error(`[sync-stock] Erro SKU ${row.sku}: ${msg}`);
        }
      }

      // Log summary
      await supabase.from("hub_logs").insert({
        workspace_id: wsId,
        action: "sync_stock",
        entity: "product",
        direction: "eccosys_to_ml",
        status: wsResult.errors > 0 ? "error" : "ok",
        details: {
          total: wsResult.total,
          stock_updated: wsResult.stock_updated,
          skipped: wsResult.skipped,
          errors: wsResult.errors,
          bulk_fetch: wsResult.bulk_fetch,
          error_details: wsResult.error_details.slice(0, 20),
          source: "cron",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error(`[sync-stock] Erro fatal workspace ${wsId}: ${msg}`);
      wsResult.errors = -1;
      wsResult.error_details.push(`fatal: ${msg}`);
    }

    results.push(wsResult);
  }

  return NextResponse.json({ results });
}
