import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "0", 10);
  const pageSize = 50;
  const search = searchParams.get("search") || "";
  const source = searchParams.get("source") || "";
  const syncStatus = searchParams.get("sync_status") || "";
  const linkedOnly = searchParams.get("linked") === "true";
  const listingType = searchParams.get("listing_type") || "";
  const sobDemandaOnly = searchParams.get("sob_demanda") === "true";

  const supabase = createAdminClient();

  // Order: parents first (ecc_pai_sku null), then children grouped by parent SKU
  let query = supabase
    .from("hub_products")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("ecc_pai_sku", { ascending: true, nullsFirst: true })
    .order("sku", { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (search) {
    query = query.or(`sku.ilike.%${search}%,nome.ilike.%${search}%`);
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (syncStatus) {
    query = query.eq("sync_status", syncStatus);
  }
  if (linkedOnly) {
    query = query.eq("linked", true);
  }
  if (listingType) {
    query = query.eq("ml_data->>listing_type_id", listingType);
  }
  if (sobDemandaOnly) {
    query = query.eq("sob_demanda", true);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    products: data || [],
    total: count ?? 0,
    page,
    pageSize,
    hasMore: (data?.length ?? 0) === pageSize,
  });
}

export async function DELETE(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const ids: string[] = body.ids || [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("hub_products")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length });
}

/**
 * PATCH — Update product fields (estoque, sob_demanda).
 * For sob_demanda products, also pushes stock to ML.
 */
export async function PATCH(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { id, estoque, sob_demanda } = body as {
    id: string;
    estoque?: number;
    sob_demanda?: boolean;
  };

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch current product
  const { data: product, error: fetchErr } = await supabase
    .from("hub_products")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (fetchErr || !product) {
    return NextResponse.json({ error: "Produto nao encontrado" }, { status: 404 });
  }

  // Build update payload
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof sob_demanda === "boolean") {
    updates.sob_demanda = sob_demanda;
  }

  if (typeof estoque === "number" && estoque >= 0) {
    updates.estoque = estoque;
    updates.ml_estoque = estoque;
  }

  // Apply DB update
  const { error: updateErr } = await supabase
    .from("hub_products")
    .update(updates)
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // If product has ML item and we're updating stock, push to ML
  const shouldPushStock =
    typeof estoque === "number" &&
    product.ml_item_id &&
    (sob_demanda === true || product.sob_demanda);

  if (shouldPushStock) {
    try {
      if (product.ml_variation_id) {
        await ml.put(
          `/items/${product.ml_item_id}/variations/${product.ml_variation_id}`,
          { available_quantity: estoque },
          workspaceId
        );
      } else {
        await ml.put(
          `/items/${product.ml_item_id}`,
          { available_quantity: estoque },
          workspaceId
        );
      }

      await supabase
        .from("hub_products")
        .update({ last_ml_sync: new Date().toISOString() })
        .eq("id", id);

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "sync_stock",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "ok",
        details: {
          reason: "manual_edit",
          old_stock: product.estoque,
          new_stock: estoque,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar ML";

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "sync_stock",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "error",
        details: { error: message },
      });

      return NextResponse.json({
        updated: true,
        ml_synced: false,
        error: message,
      });
    }
  }

  return NextResponse.json({ updated: true, ml_synced: !!shouldPushStock });
}
