import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 120;

/**
 * GET — Cron: Sync stock from Eccosys to ML for all workspaces.
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
    updated: number;
    skipped: number;
    errors: number;
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
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      // Check if ML is connected for this workspace
      const mlConnected = await ml.isConnected(wsId);
      if (!mlConnected) {
        results.push(wsResult);
        continue;
      }

      // Fetch linked products
      const { data: products } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("linked", true)
        .not("ml_item_id", "is", null)
        .eq("sync_status", "synced");

      if (!products || products.length === 0) {
        results.push(wsResult);
        continue;
      }

      wsResult.total = products.length;

      for (const row of products as HubProduct[]) {
        try {
          const estoque = await eccosys.get<EccosysEstoque>(
            `/estoques/${encodeURIComponent(row.sku)}`,
            wsId
          );

          const newStock = estoque.estoqueDisponivel;

          if (newStock === row.ml_estoque) {
            wsResult.skipped++;
            continue;
          }

          if (row.ml_variation_id) {
            await ml.put(
              `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
              { available_quantity: newStock },
              wsId
            );
          } else {
            await ml.put(
              `/items/${row.ml_item_id}`,
              { available_quantity: newStock },
              wsId
            );
          }

          await supabase
            .from("hub_products")
            .update({
              estoque: newStock,
              ml_estoque: newStock,
              last_ecc_sync: new Date().toISOString(),
              last_ml_sync: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          wsResult.updated++;
        } catch {
          wsResult.errors++;
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
          updated: wsResult.updated,
          skipped: wsResult.skipped,
          errors: wsResult.errors,
          source: "cron",
        },
      });
    } catch (err) {
      wsResult.errors = -1;
    }

    results.push(wsResult);
  }

  return NextResponse.json({ results });
}
