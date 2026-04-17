import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { pushPackToEccosys } from "@/lib/hub/push-order";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

/**
 * POST — Push a PACK of ML orders as a SINGLE consolidated Eccosys order.
 * Body: { ml_pack_id: 2000012532376667 } OR { ml_order_ids: [id1, id2, ...] }
 * Optional: { reimport: true } → resets ecc_pedido_id on all orders before pushing.
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const mlPackId = body.ml_pack_id ? Number(body.ml_pack_id) : null;
  const mlOrderIds: number[] = Array.isArray(body.ml_order_ids)
    ? body.ml_order_ids.map(Number).filter(Boolean)
    : [];
  const reimport = body.reimport === true;

  if (!mlPackId && mlOrderIds.length === 0) {
    return NextResponse.json(
      { error: "ml_pack_id or ml_order_ids required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Load orders by pack_id or by ids
  let query = supabase
    .from("hub_orders")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (mlPackId) {
    query = query.eq("ml_pack_id", mlPackId);
  } else {
    query = query.in("ml_order_id", mlOrderIds);
  }

  const { data: orderRows, error: fetchErr } = await query;

  if (fetchErr || !orderRows || orderRows.length === 0) {
    return NextResponse.json(
      { error: fetchErr?.message || "Nenhum pedido encontrado" },
      { status: 404 }
    );
  }

  const orders = orderRows as HubOrder[];

  // Skip cancelled
  const validOrders = orders.filter((o) => o.ml_status !== "cancelled");
  if (validOrders.length === 0) {
    return NextResponse.json(
      { error: "Todos os pedidos do pack estao cancelados" },
      { status: 400 }
    );
  }

  // If any order is already imported and reimport=false, block
  const alreadyImported = validOrders.filter((o) => o.ecc_pedido_id);
  if (alreadyImported.length > 0 && !reimport) {
    return NextResponse.json(
      {
        error: "Pack ja importado. Use reimport=true para reenviar (cancele o pedido antigo no Eccosys primeiro).",
        ecc_pedido_id: alreadyImported[0].ecc_pedido_id,
      },
      { status: 409 }
    );
  }

  // Reset if reimport
  if (reimport) {
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
      .in("id", validOrders.map((o) => o.id));

    // Clear local copies too
    for (const o of validOrders) {
      o.ecc_pedido_id = null;
      o.ecc_numero = null;
      o.ecc_situacao = null;
    }
  }

  try {
    const result = await pushPackToEccosys(validOrders, workspaceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";

    await supabase
      .from("hub_orders")
      .update({
        sync_status: "error",
        error_msg: message,
        updated_at: new Date().toISOString(),
      })
      .in("id", validOrders.map((o) => o.id));

    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "push_order_eccosys",
      entity: "order",
      entity_id: String(mlPackId || validOrders[0].ml_order_id),
      direction: "hub_to_eccosys",
      status: "error",
      details: {
        pack: true,
        ml_pack_id: mlPackId,
        error: message,
      },
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
