import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import { applyPromoPrice, removePromoPrice } from "@/lib/ml/promo";
import type { HubProduct } from "@/types/hub";

export const maxDuration = 120;

type BulkOperation =
  | "set"
  | "increase_pct"
  | "decrease_pct"
  | "increase_fixed"
  | "decrease_fixed";

function computeNewPrice(
  current: number,
  operation: BulkOperation,
  value: number
): number {
  switch (operation) {
    case "set":
      return value;
    case "increase_pct":
      return Math.round(current * (1 + value / 100) * 100) / 100;
    case "decrease_pct":
      return Math.round(current * (1 - value / 100) * 100) / 100;
    case "increase_fixed":
      return Math.round((current + value) * 100) / 100;
    case "decrease_fixed":
      return Math.round(Math.max(0, current - value) * 100) / 100;
  }
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_id required" },
      { status: 401 }
    );
  }

  const body = await req.json();
  const {
    ids,
    ml_category_id,
    operation,
    value,
    field = "preco",
    push_to_ml = true,
  } = body as {
    ids?: string[];
    ml_category_id?: string;
    operation: BulkOperation;
    value: number;
    field: "preco" | "preco_promocional";
    push_to_ml?: boolean;
  };

  if (!operation || value == null) {
    return NextResponse.json(
      { error: "operation and value required" },
      { status: 400 }
    );
  }
  if (!ids?.length && !ml_category_id) {
    return NextResponse.json(
      { error: "ids or ml_category_id required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  let query = supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (ids?.length) {
    query = query.in("id", ids);
  } else if (ml_category_id) {
    query = query.eq("ml_category_id", ml_category_id);
  }

  const { data: products, error: fetchErr } = await query;
  if (fetchErr || !products?.length) {
    return NextResponse.json(
      { error: fetchErr?.message || "Nenhum produto encontrado" },
      { status: 404 }
    );
  }

  let updated = 0;
  let mlSynced = 0;
  const errors: Array<{ sku: string; error: string }> = [];

  for (const row of products as HubProduct[]) {
    const currentPrice =
      field === "preco"
        ? (row.preco ?? 0)
        : (row.preco_promocional ?? row.preco ?? 0);
    const newPrice = computeNewPrice(currentPrice, operation, value);

    if (newPrice <= 0 && field === "preco") continue;

    try {
      const updatePayload: Record<string, unknown> = {
        [field]:
          field === "preco_promocional" && newPrice <= 0 ? null : newPrice,
        updated_at: new Date().toISOString(),
      };

      await supabase.from("hub_products").update(updatePayload).eq("id", row.id);
      updated++;

      // Push to ML if linked and field is preco
      if (push_to_ml && field === "preco" && row.ml_item_id && newPrice > 0) {
        try {
          if (row.ml_variation_id) {
            await ml.put(
              `/items/${row.ml_item_id}/variations/${row.ml_variation_id}`,
              { price: newPrice },
              workspaceId
            );
          } else {
            await ml.put(
              `/items/${row.ml_item_id}`,
              { price: newPrice },
              workspaceId
            );
          }

          await supabase
            .from("hub_products")
            .update({
              ml_preco: newPrice,
              last_ml_sync: new Date().toISOString(),
            })
            .eq("id", row.id);

          mlSynced++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro ML";
          errors.push({ sku: row.sku, error: message });
        }
      }

      // Push promo to ML if linked and field is preco_promocional
      if (push_to_ml && field === "preco_promocional" && row.ml_item_id) {
        try {
          const effectivePreco = row.preco || row.ml_preco || 0;

          if (newPrice > 0 && newPrice < effectivePreco) {
            const promoResult = await applyPromoPrice(row.ml_item_id, newPrice, workspaceId);
            if (promoResult.applied) mlSynced++;
            else if (promoResult.error) errors.push({ sku: row.sku, error: promoResult.error });
          } else if (newPrice <= 0) {
            const removeResult = await removePromoPrice(row.ml_item_id, workspaceId);
            if (removeResult.removed) mlSynced++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro ML promo";
          errors.push({ sku: row.sku, error: message });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar";
      errors.push({ sku: row.sku, error: message });
    }
  }

  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "sync_price",
    entity: "product",
    entity_id: null,
    direction: "hub_to_ml",
    status: errors.length > 0 ? "error" : "ok",
    details: {
      operation,
      value,
      field,
      total: products.length,
      updated,
      ml_synced: mlSynced,
      errors: errors.length,
    },
  });

  return NextResponse.json({ updated, ml_synced: mlSynced, errors });
}
