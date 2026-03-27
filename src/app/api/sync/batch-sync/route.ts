import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import { uploadNFeToML } from "@/lib/hub/nfe-upload";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 300;

interface EccosysPedido {
  id: number;
  numero: string;
  numeroDaOrdemDeCompra?: string;
  numeroPedido?: string;
  situacao: number;
  nfeNumero?: string;
  rastreamento?: string;
}

interface SyncResult {
  ml_order_id: number;
  action: "linked" | "not_found" | "already_imported" | "error";
  ecc_pedido_id?: number;
  ecc_numero?: string;
  tracking_sent?: boolean;
  nfe_sent?: boolean;
  error?: string;
}

/**
 * POST — Batch sync: find pending hub orders in Eccosys, link them,
 * and process faturamento (tracking + NF-e upload).
 *
 * Does NOT create new Eccosys orders — only links existing ones.
 * Use push-order-eccosys to create new orders.
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results: SyncResult[] = [];

  // 1. Get all pending + imported hub orders (pending to link, imported to check faturamento)
  const { data: hubOrders } = await supabase
    .from("hub_orders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("sync_status", ["pending", "imported", "tracking_sent"])
    .order("created_at", { ascending: false });

  if (!hubOrders || hubOrders.length === 0) {
    return NextResponse.json({ message: "Nenhum pedido pendente", results: [] });
  }

  const pendingOrders = hubOrders.filter((o) => o.sync_status === "pending");
  const importedOrders = hubOrders.filter((o) => o.sync_status === "imported");
  const trackingSentOrders = hubOrders.filter(
    (o) => o.sync_status === "tracking_sent" && !o.nfe_xml_sent_at
  );

  // 2. Process pending orders: find each in Eccosys individually and link
  for (const order of pendingOrders) {
    const result: SyncResult = {
      ml_order_id: order.ml_order_id,
      action: "not_found",
    };

    try {
      // Search Eccosys by numeroPedido = "ML-{ml_order_id}" (how push-order creates them)
      let eccOrder: EccosysPedido | null = null;

      try {
        const matches = await eccosys.get<EccosysPedido[]>(
          "/pedidos",
          workspaceId,
          {
            $offset: "0",
            $count: "5",
            $numeroPedido: `ML-${order.ml_order_id}`,
          }
        );
        if (Array.isArray(matches) && matches.length > 0) {
          // Verify the match is actually correct
          const match = matches.find(
            (m) =>
              m.numeroPedido === `ML-${order.ml_order_id}` ||
              m.numeroDaOrdemDeCompra === String(order.ml_order_id)
          );
          if (match) eccOrder = match;
        }
      } catch {
        // Filter may not be supported, try by numeroDaOrdemDeCompra
      }

      // Fallback: search by numeroDaOrdemDeCompra
      if (!eccOrder) {
        try {
          const matches = await eccosys.get<EccosysPedido[]>(
            "/pedidos",
            workspaceId,
            {
              $offset: "0",
              $count: "5",
              $numeroDaOrdemDeCompra: String(order.ml_order_id),
            }
          );
          if (Array.isArray(matches) && matches.length > 0) {
            const match = matches.find(
              (m) => m.numeroDaOrdemDeCompra === String(order.ml_order_id)
            );
            if (match) eccOrder = match;
          }
        } catch {
          // Filter may not be supported
        }
      }

      if (!eccOrder) {
        results.push(result);
        continue;
      }

      // Re-fetch ML order to get fresh pack_id and shipment_id
      let packId = order.ml_pack_id;
      let shipmentId = order.ml_shipment_id;
      try {
        const mlOrder = await ml.get<{
          pack_id?: number;
          shipping?: { id?: number };
        }>(`/orders/${order.ml_order_id}`, workspaceId);

        if (mlOrder.pack_id && !packId) packId = mlOrder.pack_id;
        if (mlOrder.shipping?.id && !shipmentId) shipmentId = mlOrder.shipping.id;
      } catch {
        // ML fetch failure is non-blocking
      }

      // Link the order
      const updates: Record<string, unknown> = {
        ecc_pedido_id: eccOrder.id,
        ecc_numero: eccOrder.numero,
        ecc_situacao: eccOrder.situacao,
        sync_status: "imported",
        error_msg: null,
        updated_at: new Date().toISOString(),
      };

      if (packId) updates.ml_pack_id = packId;
      if (shipmentId) updates.ml_shipment_id = shipmentId;
      if (eccOrder.nfeNumero) updates.ecc_nfe_numero = eccOrder.nfeNumero;

      await supabase.from("hub_orders").update(updates).eq("id", order.id);

      result.action = "linked";
      result.ecc_pedido_id = eccOrder.id;
      result.ecc_numero = eccOrder.numero;

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "link_order",
        entity: "order",
        entity_id: String(order.ml_order_id),
        direction: "eccosys_to_hub",
        status: "ok",
        details: {
          ecc_pedido_id: eccOrder.id,
          ecc_numero: eccOrder.numero,
          situacao: eccOrder.situacao,
          source: "batch_sync",
        },
      });

      // If faturado, process tracking + NF-e
      if (eccOrder.situacao === 1 && shipmentId) {
        // Fetch tracking
        try {
          const tracking = await eccosys.get<{ rastreio?: string }>(
            `/pedidos/${eccOrder.id}/rastreamento`,
            workspaceId
          );

          if (tracking?.rastreio) {
            await supabase
              .from("hub_orders")
              .update({
                ecc_rastreio: tracking.rastreio,
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);

            // Send tracking to ML
            try {
              await ml.post(
                `/shipments/${shipmentId}/tracking`,
                { tracking_number: tracking.rastreio },
                workspaceId
              );

              await supabase
                .from("hub_orders")
                .update({
                  sync_status: "tracking_sent",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", order.id);

              result.tracking_sent = true;

              await supabase.from("hub_logs").insert({
                workspace_id: workspaceId,
                action: "sync_nfe",
                entity: "order",
                entity_id: String(order.ml_order_id),
                direction: "hub_to_ml",
                status: "ok",
                details: {
                  rastreio: tracking.rastreio,
                  source: "batch_sync",
                  stage: "tracking",
                },
              });
            } catch (trackErr) {
              const msg = trackErr instanceof Error ? trackErr.message : "Erro";
              await supabase.from("hub_logs").insert({
                workspace_id: workspaceId,
                action: "sync_nfe",
                entity: "order",
                entity_id: String(order.ml_order_id),
                direction: "hub_to_ml",
                status: "error",
                details: { error: msg, source: "batch_sync", stage: "tracking" },
              });
            }
          }
        } catch {
          // Tracking endpoint may not exist
        }

        // Upload NF-e if available
        if (eccOrder.nfeNumero) {
          const updatedOrder: HubOrder = {
            ...(order as HubOrder),
            ecc_pedido_id: eccOrder.id,
            ecc_numero: eccOrder.numero,
            ecc_nfe_numero: eccOrder.nfeNumero,
            ml_pack_id: packId,
            ml_shipment_id: shipmentId,
            sync_status: "tracking_sent",
          };

          const nfeResult = await uploadNFeToML(updatedOrder, workspaceId);
          if (nfeResult.success) {
            result.nfe_sent = true;

            await supabase.from("hub_logs").insert({
              workspace_id: workspaceId,
              action: "sync_nfe",
              entity: "order",
              entity_id: String(order.ml_order_id),
              direction: "hub_to_ml",
              status: "ok",
              details: {
                nfe_chave: nfeResult.nfe_chave,
                source: "batch_sync",
                stage: "nfe_xml",
              },
            });
          }
        }
      }
    } catch (err) {
      result.action = "error";
      result.error = err instanceof Error ? err.message : "Erro";
    }

    results.push(result);
  }

  // 4. Process imported orders: check faturamento
  for (const order of importedOrders) {
    const result: SyncResult = {
      ml_order_id: order.ml_order_id,
      action: "already_imported",
      ecc_pedido_id: order.ecc_pedido_id,
      ecc_numero: order.ecc_numero,
    };

    try {
      const eccPedido = await eccosys.get<EccosysPedido>(
        `/pedidos/${order.ecc_pedido_id}`,
        workspaceId
      );

      const updates: Record<string, unknown> = {
        ecc_situacao: eccPedido.situacao,
        updated_at: new Date().toISOString(),
      };

      if (eccPedido.nfeNumero) updates.ecc_nfe_numero = eccPedido.nfeNumero;
      await supabase.from("hub_orders").update(updates).eq("id", order.id);

      // If faturado and has tracking
      if (eccPedido.situacao === 1 && order.ml_shipment_id) {
        try {
          const tracking = await eccosys.get<{ rastreio?: string }>(
            `/pedidos/${order.ecc_pedido_id}/rastreamento`,
            workspaceId
          );

          if (tracking?.rastreio) {
            await supabase
              .from("hub_orders")
              .update({ ecc_rastreio: tracking.rastreio })
              .eq("id", order.id);

            try {
              await ml.post(
                `/shipments/${order.ml_shipment_id}/tracking`,
                { tracking_number: tracking.rastreio },
                workspaceId
              );

              await supabase
                .from("hub_orders")
                .update({
                  sync_status: "tracking_sent",
                  error_msg: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", order.id);

              result.tracking_sent = true;
            } catch {
              // tracking send failed
            }
          }
        } catch {
          // tracking endpoint may not exist
        }

        // Try NF-e upload
        if (eccPedido.nfeNumero && result.tracking_sent) {
          const updatedOrder: HubOrder = {
            ...(order as HubOrder),
            ecc_nfe_numero: eccPedido.nfeNumero,
            sync_status: "tracking_sent",
          };
          const nfeResult = await uploadNFeToML(updatedOrder, workspaceId);
          if (nfeResult.success) result.nfe_sent = true;
        }
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : "Erro";
    }

    results.push(result);
  }

  // 5. Process tracking_sent orders: try NF-e upload
  for (const order of trackingSentOrders) {
    const result: SyncResult = {
      ml_order_id: order.ml_order_id,
      action: "already_imported",
      ecc_pedido_id: order.ecc_pedido_id,
      ecc_numero: order.ecc_numero,
    };

    try {
      if (!order.ecc_nfe_numero) {
        // Try to get NF-e number from Eccosys
        const eccPedido = await eccosys.get<EccosysPedido>(
          `/pedidos/${order.ecc_pedido_id}`,
          workspaceId
        );
        if (eccPedido.nfeNumero) {
          await supabase
            .from("hub_orders")
            .update({ ecc_nfe_numero: eccPedido.nfeNumero })
            .eq("id", order.id);
          order.ecc_nfe_numero = eccPedido.nfeNumero;
        }
      }

      if (order.ecc_nfe_numero) {
        const nfeResult = await uploadNFeToML(order as HubOrder, workspaceId);
        if (nfeResult.success) result.nfe_sent = true;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : "Erro";
    }

    results.push(result);
  }

  const summary = {
    total: results.length,
    linked: results.filter((r) => r.action === "linked").length,
    not_found: results.filter((r) => r.action === "not_found").length,
    tracking_sent: results.filter((r) => r.tracking_sent).length,
    nfe_sent: results.filter((r) => r.nfe_sent).length,
    errors: results.filter((r) => r.action === "error").length,
  };

  return NextResponse.json({ summary, results });
}
