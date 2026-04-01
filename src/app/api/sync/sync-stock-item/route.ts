import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubProduct, EccosysEstoque } from "@/types/hub";

/**
 * POST — Force sync stock for a single ML item (all variations).
 * Fetches fresh stock from Eccosys and pushes to ML.
 * Body: { ml_item_id: "MLB..." }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { ml_item_id } = body as { ml_item_id: string };

  if (!ml_item_id) {
    return NextResponse.json({ error: "ml_item_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch all hub rows for this ML item (children only — skip parent)
  const { data: rows, error } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ml_item_id", ml_item_id)
    .not("ecc_id", "is", null)
    .eq("sync_status", "synced")
    .eq("sob_demanda", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Nenhum produto vinculado encontrado para este item." }, { status: 404 });
  }

  // Fetch ALL Eccosys stock in bulk
  const eccStockMap = new Map<string, number>();
  const eccIdStockMap = new Map<number, number>();
  try {
    const allStocks = await eccosys.listAll<EccosysEstoque>(
      "/estoques",
      workspaceId,
      undefined,
      100
    );
    for (const es of allStocks) {
      const stock = typeof es.estoqueDisponivel === "number" && !isNaN(es.estoqueDisponivel) ? es.estoqueDisponivel : 0;
      eccStockMap.set(es.codigo, stock);
      if (es.idProduto) {
        const pid = parseInt(es.idProduto);
        if (!isNaN(pid)) eccIdStockMap.set(pid, stock);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Falha ao buscar estoque Eccosys: ${msg}` }, { status: 500 });
  }

  // Filter: skip parent rows that have children
  const mlChildren = (rows as HubProduct[]).filter((r) => !!r.ml_variation_id);
  const syncRows = mlChildren.length > 0
    ? mlChildren
    : (rows as HubProduct[]); // no children → sync the single row

  const results: Array<{
    sku: string;
    variation: string | null;
    old_stock: number;
    new_stock: number;
    old_ml: number | null;
    new_ml: number;
    changed: boolean;
    error?: string;
  }> = [];

  const now = new Date().toISOString();

  for (const row of syncRows) {
    try {
      // Get Eccosys stock
      let newStock: number | undefined;
      if (eccStockMap.has(row.sku)) {
        newStock = eccStockMap.get(row.sku)!;
      } else if (row.ecc_id && eccIdStockMap.has(row.ecc_id)) {
        newStock = eccIdStockMap.get(row.ecc_id)!;
      } else {
        // Individual fallback
        try {
          const est = await eccosys.get<EccosysEstoque>(
            `/estoques/${encodeURIComponent(row.sku)}`,
            workspaceId
          );
          newStock = est.estoqueDisponivel;
        } catch {
          newStock = undefined;
        }
      }

      if (newStock === undefined || isNaN(newStock)) {
        results.push({
          sku: row.sku,
          variation: row.ml_variation_id ? String(row.ml_variation_id) : null,
          old_stock: row.estoque,
          new_stock: row.estoque,
          old_ml: row.ml_estoque,
          new_ml: row.ml_estoque ?? 1,
          changed: false,
          error: "Estoque nao encontrado no Eccosys",
        });
        continue;
      }

      const mlStock = Math.max(newStock, 1);
      const changed = newStock !== row.estoque;

      // Always push to ML (force sync)
      if (newStock <= 0 && !row.ml_variation_id) {
        await ml.put(
          `/items/${row.ml_item_id}`,
          { available_quantity: 0, status: "paused" },
          workspaceId
        );
      } else if (row.ml_variation_id) {
        await ml.put(
          `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
          { available_quantity: mlStock },
          workspaceId
        );
      } else {
        const payload: Record<string, unknown> = { available_quantity: mlStock };
        if (row.ml_status === "paused" && newStock > 0) payload.status = "active";
        await ml.put(`/items/${row.ml_item_id}`, payload, workspaceId);
      }

      // Update hub
      await supabase
        .from("hub_products")
        .update({
          estoque: newStock,
          ml_estoque: newStock <= 0 && !row.ml_variation_id ? 0 : mlStock,
          ml_status: newStock <= 0 && !row.ml_variation_id ? "paused" : row.ml_status === "paused" && newStock > 0 ? "active" : row.ml_status,
          last_ecc_sync: now,
          last_ml_sync: now,
          updated_at: now,
        })
        .eq("id", row.id);

      // Log change
      if (changed) {
        await supabase.from("hub_logs").insert({
          workspace_id: workspaceId,
          action: "sync_stock",
          entity: "product",
          entity_id: ml_item_id,
          direction: "eccosys_to_ml",
          status: "ok",
          details: {
            sku: row.sku,
            ml_variation_id: row.ml_variation_id || null,
            old_stock: row.estoque,
            new_stock: newStock,
            old_ml_stock: row.ml_estoque,
            new_ml_stock: newStock <= 0 && !row.ml_variation_id ? 0 : mlStock,
            paused: newStock <= 0 && !row.ml_variation_id,
            reactivated: row.ml_status === "paused" && newStock > 0,
            source: "manual_force",
          },
        });
      }

      results.push({
        sku: row.sku,
        variation: row.ml_variation_id ? String(row.ml_variation_id) : null,
        old_stock: row.estoque,
        new_stock: newStock,
        old_ml: row.ml_estoque,
        new_ml: newStock <= 0 && !row.ml_variation_id ? 0 : mlStock,
        changed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({
        sku: row.sku,
        variation: row.ml_variation_id ? String(row.ml_variation_id) : null,
        old_stock: row.estoque,
        new_stock: row.estoque,
        old_ml: row.ml_estoque,
        new_ml: row.ml_estoque ?? 1,
        changed: false,
        error: msg,
      });
    }
  }

  const updated = results.filter((r) => r.changed).length;
  const errors = results.filter((r) => r.error);

  return NextResponse.json({ ml_item_id, updated, total: results.length, errors: errors.length, results });
}
