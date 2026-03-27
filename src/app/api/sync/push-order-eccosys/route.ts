import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { pushOrderToEccosys } from "@/lib/hub/push-order";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

/**
 * POST — Push an order from the hub to Eccosys.
 * Body: { ml_order_id: 2000003508419013 }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const mlOrderId = body.ml_order_id;
  if (!mlOrderId) {
    return NextResponse.json(
      { error: "ml_order_id required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Fetch order from hub
  const { data: orderData, error: fetchErr } = await supabase
    .from("hub_orders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ml_order_id", mlOrderId)
    .single();

  if (fetchErr || !orderData) {
    return NextResponse.json(
      { error: fetchErr?.message || "Pedido nao encontrado no hub" },
      { status: 404 }
    );
  }

  const order = orderData as HubOrder;

  // Check if already imported
  if (order.ecc_pedido_id) {
    return NextResponse.json(
      {
        error: "Pedido ja importado no Eccosys",
        ecc_pedido_id: order.ecc_pedido_id,
        ecc_numero: order.ecc_numero,
      },
      { status: 409 }
    );
  }

  try {
    const result = await pushOrderToEccosys(order, workspaceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";

    // Mark order as error
    await supabase
      .from("hub_orders")
      .update({
        sync_status: "error",
        error_msg: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "push_order_eccosys",
      entity: "order",
      entity_id: String(order.ml_order_id),
      direction: "hub_to_eccosys",
      status: "error",
      details: { error: message },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
