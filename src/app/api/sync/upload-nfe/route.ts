import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { uploadNFeToML } from "@/lib/hub/nfe-upload";
import { eccosys } from "@/lib/eccosys/client";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

/**
 * GET — List orders ready for NF-e upload (faturados with NF, not yet uploaded).
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
    .not("ecc_nfe_numero", "is", null)
    .is("nfe_xml_sent_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data || [] });
}

/**
 * POST — Upload NF-e XML to ML for specified orders.
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

      if (!order.ecc_pedido_id) {
        errors.push({ ml_order_id: mlOrderId, error: "Sem ecc_pedido_id" });
        continue;
      }

      if (order.nfe_xml_sent_at) {
        errors.push({ ml_order_id: mlOrderId, error: "NFe ja enviada" });
        continue;
      }

      // If hub doesn't have ecc_nfe_numero yet, try fetching from Eccosys
      if (!order.ecc_nfe_numero) {
        try {
          const result = await eccosys.get<Record<string, unknown> | Record<string, unknown>[]>(
            `/pedidos/${order.ecc_pedido_id}`,
            workspaceId
          );

          // Eccosys may return an array or a single object — normalize
          const eccPedido = (Array.isArray(result) ? result[0] : result) as Record<string, unknown>;

          // Eccosys field is "numeroNotaFiscal"
          const rawNfe = eccPedido?.numeroNotaFiscal;
          const nfeNumero = rawNfe ? String(rawNfe) : null;

          const situacao =
            (eccPedido?.situacao as number) ??
            (eccPedido?.idSituacao as number) ??
            null;

          if (nfeNumero) {
            order.ecc_nfe_numero = nfeNumero;
            await supabase
              .from("hub_orders")
              .update({
                ecc_nfe_numero: nfeNumero,
                ecc_situacao: situacao,
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);
          } else {
            // Return the raw Eccosys keys to help debugging
            const keys = eccPedido ? Object.keys(eccPedido).join(", ") : "(empty)";
            errors.push({
              ml_order_id: mlOrderId,
              error: `NF nao encontrada no pedido Eccosys ${order.ecc_pedido_id}. Campos: ${keys}`,
            });
            continue;
          }
        } catch (err) {
          errors.push({
            ml_order_id: mlOrderId,
            error: `Erro ao buscar NF no Eccosys: ${err instanceof Error ? err.message : "desconhecido"}`,
          });
          continue;
        }
      }

      const result = await uploadNFeToML(order, workspaceId);

      if (result.success) {
        sent++;

        await supabase.from("hub_logs").insert({
          workspace_id: workspaceId,
          action: "sync_nfe",
          entity: "order",
          entity_id: String(mlOrderId),
          direction: "hub_to_ml",
          status: "ok",
          details: {
            nfe_chave: result.nfe_chave,
            ml_pack_id: order.ml_pack_id,
            source: "manual",
            stage: "nfe_xml",
          },
        });
      } else {
        errors.push({
          ml_order_id: mlOrderId,
          error: result.error || "Erro desconhecido",
        });

        await supabase.from("hub_logs").insert({
          workspace_id: workspaceId,
          action: "sync_nfe",
          entity: "order",
          entity_id: String(mlOrderId),
          direction: "hub_to_ml",
          status: "error",
          details: { error: result.error, source: "manual", stage: "nfe_xml" },
        });
      }
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
        details: { error: message, source: "manual", stage: "nfe_xml" },
      });
    }
  }

  return NextResponse.json({ sent, errors });
}
