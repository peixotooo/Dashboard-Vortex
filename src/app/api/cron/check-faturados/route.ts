import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";

export const maxDuration = 120;

interface EccosysPedido {
  id: number;
  numero: string;
  numeroDaOrdemDeCompra?: string;
  situacao: number;
  nfeNumero?: string;
  rastreamento?: string;
}

/**
 * GET — Cron: Check for faturados (shipped) orders in Eccosys,
 * update hub_orders, and auto-send tracking to ML if available.
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
    checked: number;
    updated: number;
    tracking_sent: number;
    error?: string;
  }> = [];

  // Find all workspaces with Eccosys connections
  const { data: connections } = await supabase
    .from("eccosys_connections")
    .select("workspace_id");

  if (!connections || connections.length === 0) {
    return NextResponse.json({
      message: "Nenhum workspace com Eccosys configurado",
      results: [],
    });
  }

  for (const conn of connections) {
    const wsId = conn.workspace_id;
    const wsResult: { workspace_id: string; checked: number; updated: number; tracking_sent: number; error?: string } = { workspace_id: wsId, checked: 0, updated: 0, tracking_sent: 0 };

    try {
      // Get hub_orders that are imported but not yet tracking_sent
      const { data: hubOrders } = await supabase
        .from("hub_orders")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("sync_status", "imported")
        .not("ecc_pedido_id", "is", null);

      if (!hubOrders || hubOrders.length === 0) {
        results.push(wsResult);
        continue;
      }

      wsResult.checked = hubOrders.length;

      for (const order of hubOrders) {
        try {
          // Fetch current status from Eccosys
          const eccPedido = await eccosys.get<EccosysPedido>(
            `/pedidos/${order.ecc_pedido_id}`,
            wsId
          );

          const updates: Record<string, unknown> = {
            ecc_situacao: eccPedido.situacao,
            updated_at: new Date().toISOString(),
          };

          if (eccPedido.nfeNumero) {
            updates.ecc_nfe_numero = eccPedido.nfeNumero;
          }

          // Check for tracking info
          let rastreio: string | null = null;
          if (eccPedido.situacao === 1) {
            try {
              const tracking = await eccosys.get<{ rastreio?: string }>(
                `/pedidos/${order.ecc_pedido_id}/rastreamento`,
                wsId
              );
              if (tracking?.rastreio) {
                rastreio = tracking.rastreio;
                updates.ecc_rastreio = rastreio;
              }
            } catch {
              // Tracking endpoint may not exist
            }
          }

          await supabase
            .from("hub_orders")
            .update(updates)
            .eq("id", order.id);

          wsResult.updated++;

          // Auto-send tracking to ML if we have all needed data
          if (rastreio && order.ml_shipment_id) {
            try {
              await ml.post(
                `/shipments/${order.ml_shipment_id}/tracking`,
                { tracking_number: rastreio },
                wsId
              );

              await supabase
                .from("hub_orders")
                .update({
                  sync_status: "tracking_sent",
                  error_msg: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", order.id);

              wsResult.tracking_sent++;

              await supabase.from("hub_logs").insert({
                workspace_id: wsId,
                action: "sync_nfe",
                entity: "order",
                entity_id: String(order.ml_order_id),
                direction: "hub_to_ml",
                status: "ok",
                details: {
                  ml_shipment_id: order.ml_shipment_id,
                  rastreio,
                  source: "cron",
                },
              });
            } catch (trackErr) {
              const msg = trackErr instanceof Error ? trackErr.message : "Erro";
              await supabase.from("hub_logs").insert({
                workspace_id: wsId,
                action: "sync_nfe",
                entity: "order",
                entity_id: String(order.ml_order_id),
                direction: "hub_to_ml",
                status: "error",
                details: { error: msg, source: "cron" },
              });
            }
          }
        } catch {
          // Individual order fetch failure — continue
        }
      }
    } catch (err) {
      wsResult.error = err instanceof Error ? err.message : "Erro";
    }

    results.push(wsResult);
  }

  return NextResponse.json({ results });
}
