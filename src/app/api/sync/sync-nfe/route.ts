import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

/**
 * GET — List orders ready for tracking (faturados with rastreio, not yet sent).
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("hub_orders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ecc_situacao", 1)
    .not("ecc_rastreio", "is", null)
    .not("ml_shipment_id", "is", null)
    .neq("sync_status", "tracking_sent")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data || [] });
}

/**
 * POST — Send tracking to ML for specified orders.
 * Body: { ml_order_ids: [123, 456] }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const mlOrderIds: number[] = body.ml_order_ids || [];

  if (mlOrderIds.length === 0) {
    return NextResponse.json(
      { error: "ml_order_ids (array) required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  let sent = 0;
  const errors: Array<{ ml_order_id: number; error: string }> = [];

  for (const mlOrderId of mlOrderIds) {
    try {
      const { data: orderData } = await supabase
        .from("hub_orders")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("ml_order_id", mlOrderId)
        .single();

      if (!orderData) {
        errors.push({ ml_order_id: mlOrderId, error: "Pedido nao encontrado" });
        continue;
      }

      const order = orderData as HubOrder;

      if (!order.ml_shipment_id) {
        errors.push({ ml_order_id: mlOrderId, error: "Sem shipment_id ML" });
        continue;
      }

      if (!order.ecc_rastreio) {
        errors.push({ ml_order_id: mlOrderId, error: "Sem codigo de rastreio" });
        continue;
      }

      // Send tracking to ML
      await ml.post(
        `/shipments/${order.ml_shipment_id}/tracking`,
        { tracking_number: order.ecc_rastreio },
        workspaceId
      );

      // Update order status
      await supabase
        .from("hub_orders")
        .update({
          sync_status: "tracking_sent",
          error_msg: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      sent++;

      // Log
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "sync_nfe",
        entity: "order",
        entity_id: String(mlOrderId),
        direction: "hub_to_ml",
        status: "ok",
        details: {
          ml_shipment_id: order.ml_shipment_id,
          rastreio: order.ecc_rastreio,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ ml_order_id: mlOrderId, error: message });

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "sync_nfe",
        entity: "order",
        entity_id: String(mlOrderId),
        direction: "hub_to_ml",
        status: "error",
        details: { error: message },
      });
    }
  }

  return NextResponse.json({ sent, errors });
}
