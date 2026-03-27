import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import type { HubOrderItem, HubProduct } from "@/types/hub";

export const maxDuration = 60;

interface MLOrder {
  id: number;
  status: string;
  date_created: string;
  total_amount: number;
  buyer: {
    id: number;
    nickname: string;
    first_name: string;
    last_name: string;
    email?: string;
  };
  order_items: Array<{
    item: { id: string; title: string; seller_sku?: string; seller_custom_field?: string };
    quantity: number;
    unit_price: number;
  }>;
  payments: Array<{
    payment_type: string;
    total_paid_amount: number;
    status: string;
  }>;
  pack_id?: number;
  shipping: { id?: number };
  tags?: string[];
}

interface MLShipment {
  id: number;
  shipping_option?: { cost: number };
  receiver_address?: {
    address_line: string;
    zip_code: string;
    city: { name: string };
    state: { name: string; id: string };
    country: { name: string };
    neighborhood?: { name: string };
    comment?: string;
  };
}

/**
 * POST — Import an ML order into the hub.
 * Body: { resource: "/orders/123" } (from webhook) OR { ml_order_id: 123 }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();

  // Extract order ID from resource path or direct id
  let orderId: number;
  if (body.resource) {
    const match = String(body.resource).match(/orders\/(\d+)/);
    if (!match) {
      return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
    }
    orderId = parseInt(match[1], 10);
  } else if (body.ml_order_id) {
    orderId = Number(body.ml_order_id);
  } else {
    return NextResponse.json(
      { error: "resource or ml_order_id required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  try {
    // Fetch order from ML
    const order = await ml.get<MLOrder>(`/orders/${orderId}`, workspaceId);

    // Fetch shipment for address + shipping cost
    let shipment: MLShipment | null = null;
    if (order.shipping?.id) {
      try {
        shipment = await ml.get<MLShipment>(
          `/shipments/${order.shipping.id}`,
          workspaceId
        );
      } catch {
        // Shipment may not be accessible yet
      }
    }

    // Resolve SKUs via hub_products
    const items: HubOrderItem[] = order.order_items.map((oi) => {
      const sku =
        oi.item.seller_sku ||
        oi.item.seller_custom_field ||
        `ML-${oi.item.id}`;
      return {
        sku,
        nome: oi.item.title,
        qtd: oi.quantity,
        preco: oi.unit_price,
        ml_item_id: oi.item.id,
      };
    });

    // Build address from shipment
    const endereco = shipment?.receiver_address
      ? {
          endereco: shipment.receiver_address.address_line,
          cep: shipment.receiver_address.zip_code,
          cidade: shipment.receiver_address.city?.name,
          uf: shipment.receiver_address.state?.id,
          estado: shipment.receiver_address.state?.name,
          pais: shipment.receiver_address.country?.name || "Brasil",
          bairro: shipment.receiver_address.neighborhood?.name || "",
          complemento: shipment.receiver_address.comment || "",
        }
      : null;

    // Build payment info
    const firstPayment = order.payments?.[0];
    const pagamento = firstPayment
      ? {
          tipo: firstPayment.payment_type,
          valor: firstPayment.total_paid_amount,
          status: firstPayment.status,
        }
      : null;

    const frete = shipment?.shipping_option?.cost || 0;
    const buyerName = `${order.buyer.first_name} ${order.buyer.last_name}`.trim();

    const row = {
      workspace_id: workspaceId,
      ml_order_id: order.id,
      ml_shipment_id: shipment?.id || null,
      ml_pack_id: order.pack_id || null,
      ml_status: order.status,
      ml_date: order.date_created,
      buyer_name: buyerName,
      buyer_email: order.buyer.email || null,
      total: order.total_amount,
      frete,
      items,
      endereco,
      pagamento,
      sync_status: "pending" as const,
      updated_at: new Date().toISOString(),
    };

    // Check if this order already exists (to avoid double stock deduction)
    const { data: existingOrder } = await supabase
      .from("hub_orders")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("ml_order_id", orderId)
      .single();

    const isNewOrder = !existingOrder;

    await supabase
      .from("hub_orders")
      .upsert(row, { onConflict: "workspace_id,ml_order_id" });

    // Deduct virtual stock for sob_demanda products (only for new orders)
    let stockDeducted = 0;
    if (isNewOrder && order.status === "paid") {
      for (const item of items) {
        try {
          const { data: product } = await supabase
            .from("hub_products")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("sku", item.sku)
            .eq("sob_demanda", true)
            .single();

          if (!product) continue;

          const prev = (product as HubProduct).estoque ?? 0;
          const newStock = Math.max(0, prev - item.qtd);

          await supabase
            .from("hub_products")
            .update({
              estoque: newStock,
              ml_estoque: newStock,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (product as HubProduct).id);

          // Push updated stock to ML
          if ((product as HubProduct).ml_item_id) {
            try {
              if ((product as HubProduct).ml_variation_id) {
                await ml.put(
                  `/items/${(product as HubProduct).ml_item_id}/variations/${(product as HubProduct).ml_variation_id}`,
                  { available_quantity: newStock },
                  workspaceId
                );
              } else {
                await ml.put(
                  `/items/${(product as HubProduct).ml_item_id}`,
                  { available_quantity: newStock },
                  workspaceId
                );
              }
            } catch {
              // ML push failure is non-blocking
            }
          }

          stockDeducted++;

          await supabase.from("hub_logs").insert({
            workspace_id: workspaceId,
            action: "sync_stock",
            entity: "product",
            entity_id: item.sku,
            direction: "hub_to_ml",
            status: "ok",
            details: {
              reason: "order_sale",
              ml_order_id: orderId,
              old_stock: prev,
              new_stock: newStock,
              qty_sold: item.qtd,
            },
          });
        } catch {
          // Individual item deduction failure is non-blocking
        }
      }
    }

    // Log
    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "pull_order",
      entity: "order",
      entity_id: String(orderId),
      direction: "ml_to_hub",
      status: "ok",
      details: {
        ml_status: order.status,
        buyer: buyerName,
        total: order.total_amount,
        items_count: items.length,
        stock_deducted: stockDeducted,
      },
    });

    return NextResponse.json({ ok: true, ml_order_id: orderId, stock_deducted: stockDeducted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";

    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "pull_order",
      entity: "order",
      entity_id: String(orderId),
      direction: "ml_to_hub",
      status: "error",
      details: { error: message },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
