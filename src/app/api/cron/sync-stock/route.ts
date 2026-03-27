import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import { applyPromoPrice } from "@/lib/ml/promo";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

export const maxDuration = 300;

interface EccosysProduto {
  id: number;
  codigo: string;
  preco: number;
  precoPromocional?: number | null;
  [key: string]: unknown;
}

/**
 * GET — Cron: Sync stock + price from Eccosys to ML for all workspaces.
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
    price_updated: number;
    promo_updated: number;
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
      stock_updated: 0,
      price_updated: 0,
      promo_updated: 0,
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

      wsResult.total = products.length;

      // Fetch ALL Eccosys products in bulk to build price map
      // This avoids one API call per product for price info
      const eccPriceMap = new Map<string, { preco: number; precoPromocional: number | null }>();
      try {
        const allEccProducts = await eccosys.listAll<EccosysProduto>(
          "/produtos",
          wsId,
          undefined,
          100
        );
        for (const ep of allEccProducts) {
          eccPriceMap.set(
            ep.codigo,
            {
              preco: ep.preco,
              precoPromocional: ep.precoPromocional ?? null,
            }
          );
        }
      } catch {
        // If bulk fetch fails, continue with stock-only sync
      }

      const now = new Date().toISOString();

      for (const row of products as HubProduct[]) {
        try {
          // --- Stock sync ---
          const estoque = await eccosys.get<EccosysEstoque>(
            `/estoques/${encodeURIComponent(row.sku)}`,
            wsId
          );
          const newStock = estoque.estoqueDisponivel;
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

          // --- Price sync (from Eccosys bulk map) ---
          const eccPrice = eccPriceMap.get(row.sku);
          let priceChanged = false;
          let promoChanged = false;

          if (eccPrice) {
            const newPreco = eccPrice.preco;
            const newPromo = eccPrice.precoPromocional;

            // Regular price changed
            if (newPreco && newPreco !== row.preco) {
              if (row.ml_variation_id) {
                await ml.put(
                  `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
                  { price: newPreco },
                  wsId
                );
              } else {
                await ml.put(
                  `/items/${row.ml_item_id}`,
                  { price: newPreco },
                  wsId
                );
              }
              priceChanged = true;
              wsResult.price_updated++;
            }

            // Promotional price changed
            const currentPromo = row.preco_promocional ?? null;
            const effectivePreco = newPreco || row.preco || 0;

            if (newPromo !== currentPromo) {
              if (newPromo && newPromo > 0 && newPromo < effectivePreco && row.ml_item_id) {
                await applyPromoPrice(row.ml_item_id, newPromo, wsId);
                promoChanged = true;
                wsResult.promo_updated++;
              }
            }
          }

          // --- Update hub_products ---
          if (stockChanged || priceChanged || promoChanged) {
            const updates: Record<string, unknown> = {
              last_ecc_sync: now,
              last_ml_sync: now,
              updated_at: now,
            };
            if (stockChanged) {
              updates.estoque = newStock;
              updates.ml_estoque = mlStock;
            }
            if (priceChanged && eccPrice) {
              updates.preco = eccPrice.preco;
              updates.ml_preco = eccPrice.preco;
            }
            if (promoChanged && eccPrice) {
              updates.preco_promocional = eccPrice.precoPromocional;
            }

            await supabase.from("hub_products").update(updates).eq("id", row.id);
          } else {
            wsResult.skipped++;
          }
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
          stock_updated: wsResult.stock_updated,
          price_updated: wsResult.price_updated,
          promo_updated: wsResult.promo_updated,
          skipped: wsResult.skipped,
          errors: wsResult.errors,
          source: "cron",
        },
      });
    } catch {
      wsResult.errors = -1;
    }

    results.push(wsResult);
  }

  return NextResponse.json({ results });
}
