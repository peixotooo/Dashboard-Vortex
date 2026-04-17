import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { pushOrderToEccosys } from "@/lib/hub/push-order";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

/**
 * POST — Reset + push an order (or all orders of a pack) to Eccosys.
 * Body: { ml_order_id: 123 } or { ml_order_ids: [123, 456] }
 *
 * Use this to fix orders that were imported with incomplete data (CPF missing,
 * transportadora not linked, etc). The OLD order must be cancelled manually
 * in Eccosys — this creates a NEW order with the latest payload.
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const ids: number[] = Array.isArray(body.ml_order_ids)
    ? body.ml_order_ids.map(Number).filter(Boolean)
    : body.ml_order_id
      ? [Number(body.ml_order_id)]
      : [];

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "ml_order_id or ml_order_ids required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const results: Array<{
    ml_order_id: number;
    ok: boolean;
    ecc_pedido_id?: number | null;
    ecc_numero?: string | null;
    error?: string;
    previous_ecc_pedido_id?: number | null;
  }> = [];

  for (const mlOrderId of ids) {
    // Load current state
    const { data: orderData } = await supabase
      .from("hub_orders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("ml_order_id", mlOrderId)
      .single();

    if (!orderData) {
      results.push({ ml_order_id: mlOrderId, ok: false, error: "Pedido nao encontrado no hub" });
      continue;
    }

    const order = orderData as HubOrder;
    const previousEccId = order.ecc_pedido_id;

    // Reset (clear Eccosys link) so pushOrderToEccosys accepts the order
    await supabase
      .from("hub_orders")
      .update({
        sync_status: "pending",
        ecc_pedido_id: null,
        ecc_numero: null,
        ecc_situacao: null,
        error_msg: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Clear the local copy so push treats it as fresh
    order.ecc_pedido_id = null;
    order.ecc_numero = null;
    order.ecc_situacao = null;

    try {
      const pushed = await pushOrderToEccosys(order, workspaceId);
      results.push({
        ml_order_id: mlOrderId,
        ok: true,
        ecc_pedido_id: pushed.ecc_pedido_id,
        ecc_numero: pushed.ecc_numero,
        previous_ecc_pedido_id: previousEccId,
      });

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_order_eccosys",
        entity: "order",
        entity_id: String(mlOrderId),
        direction: "hub_to_eccosys",
        status: "ok",
        details: {
          reimport: true,
          previous_ecc_pedido_id: previousEccId,
          new_ecc_pedido_id: pushed.ecc_pedido_id,
          new_ecc_numero: pushed.ecc_numero,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({ ml_order_id: mlOrderId, ok: false, error: message });

      await supabase
        .from("hub_orders")
        .update({
          sync_status: "error",
          error_msg: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ total: results.length, ok: okCount, results });
}
