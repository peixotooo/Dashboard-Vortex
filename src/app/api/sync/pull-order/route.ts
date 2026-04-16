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
    street_name?: string;
    street_number?: string;
    zip_code: string;
    city: { id?: string; name: string };
    state: { name: string; id: string };
    country: { name: string };
    neighborhood?: { name: string };
    comment?: string;
    receiver_phone?: string;
    receiver_name?: string;
  };
}

interface MLBillingInfo {
  billing_info?: {
    doc_type?: string;
    doc_number?: string;
    additional_info?: Array<{ type: string; value: string }>;
  };
  doc_type?: string;
  doc_number?: string;
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

    // Fetch billing info (CPF/CNPJ)
    let buyerDoc: string | null = null;
    try {
      const billing = await ml.get<MLBillingInfo>(
        `/orders/${orderId}/billing_info`,
        workspaceId
      );
      buyerDoc =
        billing.billing_info?.doc_number ||
        billing.doc_number ||
        null;
    } catch {
      // billing_info may not be available
    }
    // Fallback: try receiver_phone or look in additional_info
    if (!buyerDoc && shipment?.receiver_address?.comment) {
      const docMatch = shipment.receiver_address.comment.match(/\b(\d{11}|\d{14})\b/);
      if (docMatch) buyerDoc = docMatch[1];
    }

    // Fetch fiscal documents (NF-e) from ML
    let mlNfeNumero: string | null = null;
    let mlNfeChave: string | null = null;
    const packId = order.pack_id || order.id;

    // Try ML fiscal documents endpoint
    try {
      const fiscal = await ml.get<Record<string, unknown>>(
        `/packs/${packId}/fiscal_documents`,
        workspaceId
      );
      const docs = (fiscal?.fiscal_documents || []) as Array<Record<string, unknown>>;
      if (Array.isArray(docs) && docs.length > 0) {
        const nfe = docs.find((d) => d.fiscal_document_number);
        if (nfe) {
          mlNfeNumero = (nfe.fiscal_document_number as string) || null;
          mlNfeChave = (nfe.access_key as string) || null;
        }
      }
    } catch {
      // NF-e not yet on ML — will come from Eccosys via check-faturados cron
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

    // Build address from shipment — extract street + number
    let ruaName = shipment?.receiver_address?.street_name || "";
    let numero = shipment?.receiver_address?.street_number || "";
    if (!ruaName && shipment?.receiver_address?.address_line) {
      // Parse "Rua X, 123" or "Rua X 123" formats
      const line = shipment.receiver_address.address_line.trim();
      const match = line.match(/^(.+?)[,\s]+(\d+\w*)$/);
      if (match) {
        ruaName = match[1].trim();
        numero = match[2].trim();
      } else {
        ruaName = line;
      }
    }
    if (!numero) numero = "S/N";

    const endereco = shipment?.receiver_address
      ? {
          endereco: ruaName,
          numero,
          cep: shipment.receiver_address.zip_code,
          cidade: shipment.receiver_address.city?.name,
          idCidadeMl: shipment.receiver_address.city?.id || null,
          uf: shipment.receiver_address.state?.id,
          estado: shipment.receiver_address.state?.name,
          pais: shipment.receiver_address.country?.name || "Brasil",
          bairro: shipment.receiver_address.neighborhood?.name || "",
          complemento: shipment.receiver_address.comment || "",
          telefone: shipment.receiver_address.receiver_phone || "",
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

    const row: Record<string, unknown> = {
      workspace_id: workspaceId,
      ml_order_id: order.id,
      ml_shipment_id: shipment?.id || null,
      ml_pack_id: order.pack_id || null,
      ml_status: order.status,
      ml_date: order.date_created,
      buyer_name: buyerName,
      buyer_email: order.buyer.email || null,
      buyer_doc: buyerDoc,
      total: order.total_amount,
      frete,
      items,
      endereco,
      pagamento,
      sync_status: order.status === "cancelled" ? "ignored" as const : "pending" as const,
      updated_at: new Date().toISOString(),
    };

    // Add NF-e from ML if available (don't overwrite existing Eccosys NF-e)
    if (mlNfeNumero) row.ecc_nfe_numero = mlNfeNumero;
    if (mlNfeChave) row.ecc_nfe_chave = mlNfeChave;

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

    return NextResponse.json({
      ok: true,
      ml_order_id: orderId,
      stock_deducted: stockDeducted,
      buyer_doc: buyerDoc,
    });
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
