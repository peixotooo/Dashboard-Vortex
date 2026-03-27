import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import { uploadNFeToML } from "@/lib/hub/nfe-upload";
import type { HubOrder } from "@/types/hub";

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
 * update hub_orders, auto-send tracking to ML, and upload NF-e XML.
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
    nfe_sent: number;
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
    const wsResult: {
      workspace_id: string;
      checked: number;
      updated: number;
      tracking_sent: number;
      nfe_sent: number;
      error?: string;
    } = {
      workspace_id: wsId,
      checked: 0,
      updated: 0,
      tracking_sent: 0,
      nfe_sent: 0,
    };

    try {
      // Phase 1: Check imported orders for faturamento + tracking
      const { data: importedOrders } = await supabase
        .from("hub_orders")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("sync_status", "imported")
        .not("ecc_pedido_id", "is", null);

      // Phase 2: Find tracking_sent orders that still need NF-e upload
      const { data: trackingSentOrders } = await supabase
        .from("hub_orders")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("sync_status", "tracking_sent")
        .not("ecc_pedido_id", "is", null)
        .is("nfe_xml_sent_at", null);

      const ordersToCheck = importedOrders || [];
      const ordersNeedingNfe = trackingSentOrders || [];

      if (ordersToCheck.length === 0 && ordersNeedingNfe.length === 0) {
        results.push(wsResult);
        continue;
      }

      wsResult.checked = ordersToCheck.length + ordersNeedingNfe.length;

      // --- Phase 1: Check Eccosys status + send tracking ---
      for (const order of ordersToCheck) {
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
                  stage: "tracking",
                },
              });

              // After tracking sent, try NF-e upload immediately if NF available
              if (eccPedido.nfeNumero) {
                const updatedOrder: HubOrder = {
                  ...order,
                  ecc_nfe_numero: eccPedido.nfeNumero,
                  sync_status: "tracking_sent",
                };
                await tryUploadNfe(updatedOrder, wsId, wsResult, supabase);
              }
            } catch (trackErr) {
              const msg = trackErr instanceof Error ? trackErr.message : "Erro";
              await supabase.from("hub_logs").insert({
                workspace_id: wsId,
                action: "sync_nfe",
                entity: "order",
                entity_id: String(order.ml_order_id),
                direction: "hub_to_ml",
                status: "error",
                details: { error: msg, source: "cron", stage: "tracking" },
              });
            }
          }
        } catch {
          // Individual order fetch failure — continue
        }
      }

      // --- Phase 2: Upload NF-e for tracking_sent orders ---
      for (const order of ordersNeedingNfe) {
        if (!order.ecc_nfe_numero) {
          // Try to fetch nfe_numero from Eccosys first
          try {
            const eccPedido = await eccosys.get<EccosysPedido>(
              `/pedidos/${order.ecc_pedido_id}`,
              wsId
            );
            if (eccPedido.nfeNumero) {
              await supabase
                .from("hub_orders")
                .update({
                  ecc_nfe_numero: eccPedido.nfeNumero,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", order.id);
              order.ecc_nfe_numero = eccPedido.nfeNumero;
            } else {
              continue; // No NF yet
            }
          } catch {
            continue;
          }
        }

        await tryUploadNfe(order as HubOrder, wsId, wsResult, supabase);
      }
    } catch (err) {
      wsResult.error = err instanceof Error ? err.message : "Erro";
    }

    results.push(wsResult);
  }

  return NextResponse.json({ results });
}

/** Try to upload NF-e XML, log result. Non-blocking on failure. */
async function tryUploadNfe(
  order: HubOrder,
  wsId: string,
  wsResult: { nfe_sent: number },
  supabase: ReturnType<typeof createAdminClient>
) {
  try {
    const result = await uploadNFeToML(order, wsId);

    if (result.success) {
      wsResult.nfe_sent++;
      await supabase.from("hub_logs").insert({
        workspace_id: wsId,
        action: "sync_nfe",
        entity: "order",
        entity_id: String(order.ml_order_id),
        direction: "hub_to_ml",
        status: "ok",
        details: {
          nfe_chave: result.nfe_chave,
          ml_pack_id: order.ml_pack_id,
          source: "cron",
          stage: "nfe_xml",
        },
      });
    } else {
      await supabase.from("hub_logs").insert({
        workspace_id: wsId,
        action: "sync_nfe",
        entity: "order",
        entity_id: String(order.ml_order_id),
        direction: "hub_to_ml",
        status: "error",
        details: {
          error: result.error,
          source: "cron",
          stage: "nfe_xml",
        },
      });
    }
  } catch (nfeErr) {
    const msg = nfeErr instanceof Error ? nfeErr.message : "Erro";
    await supabase.from("hub_logs").insert({
      workspace_id: wsId,
      action: "sync_nfe",
      entity: "order",
      entity_id: String(order.ml_order_id),
      direction: "hub_to_ml",
      status: "error",
      details: { error: msg, source: "cron", stage: "nfe_xml" },
    });
  }
}
