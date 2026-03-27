import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 120;

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

  let updated = 0;
  let skipped = 0;
  const errors: Array<{ sku: string; error: string }> = [];

  for (const row of products as HubProduct[]) {
    try {
      // Get current Eccosys stock
      const estoque = await eccosys.get<EccosysEstoque>(
        `/estoques/${encodeURIComponent(row.sku)}`,
        workspaceId
      );

      const newStock = estoque.estoqueDisponivel;

      // Compare with current ML stock
      if (newStock === row.ml_estoque) {
        skipped++;
        continue;
      }

      // Update ML
      if (row.ml_variation_id) {
        // Variation product
        await ml.put(
          `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
          { available_quantity: newStock },
          workspaceId
        );
      } else {
        // Simple product
        await ml.put(
          `/items/${row.ml_item_id}`,
          { available_quantity: newStock },
          workspaceId
        );
      }

      // Update hub
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
    status: errors.length > 0 ? "error" : "ok",
    details: {
      total: products.length,
      updated,
      skipped,
      errors: errors.length,
    },
  });

  return NextResponse.json({ updated, skipped, errors });
}
