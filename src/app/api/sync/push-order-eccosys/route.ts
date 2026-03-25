import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { HubOrder } from "@/types/hub";

export const maxDuration = 60;

// ML payment type → Eccosys forma de pagamento
const PAYMENT_MAP: Record<string, number> = {
  credit_card: 3,
  debit_card: 4,
  bank_transfer: 18,
  ticket: 15, // boleto
  account_money: 99,
  digital_wallet: 17, // PIX
};

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
    // Get ML sales channel id from Eccosys
    let canalMlId: number | null = null;
    try {
      const canais = await eccosys.get<
        Array<{ id: number; idMarketplace: number }>
      >("/canaisDeVenda", workspaceId);
      if (Array.isArray(canais)) {
        const mlCanal = canais.find((c) => c.idMarketplace === 3);
        if (mlCanal) canalMlId = mlCanal.id;
      }
    } catch {
      // Not critical — continue without canal
    }

    // Resolve SKUs: make sure they exist in hub_products
    const skus = (order.items || []).map((i) => i.sku);
    const { data: hubProducts } = await supabase
      .from("hub_products")
      .select("sku")
      .eq("workspace_id", workspaceId)
      .in("sku", skus);

    const knownSkus = new Set((hubProducts || []).map((p) => p.sku));

    // Build Eccosys payload
    const orderDate = order.ml_date
      ? order.ml_date.split("T")[0]
      : new Date().toISOString().split("T")[0];
    const totalProdutos = Number(order.total || 0);
    const frete = Number(order.frete || 0);
    const totalVenda = totalProdutos + frete;

    const paymentType = (order.pagamento as Record<string, unknown>)?.tipo as
      | string
      | undefined;

    const endereco = order.endereco as Record<string, string> | null;
    const buyerDoc = order.buyer_doc || "";

    const payload = {
      data: orderDate,
      situacao: 0, // Em aberto
      totalProdutos,
      totalVenda,
      frete,
      numeroPedido: `ML-${order.ml_order_id}`,
      numeroDaOrdemDeCompra: String(order.ml_order_id),
      ...(canalMlId ? { idCanalVenda: canalMlId } : {}),
      observacaoInterna: `Importado do ML - Pedido ${order.ml_order_id}`,
      _Contato: {
        nome: order.buyer_name || "Comprador ML",
        cnpj: buyerDoc,
        ...(endereco || {}),
        tipo: buyerDoc.replace(/\D/g, "").length > 11 ? "J" : "F",
        identificadorIE: 9,
      },
      _Itens: (order.items || []).map((item) => ({
        codigo: knownSkus.has(item.sku) ? item.sku : item.sku,
        descricao: item.nome,
        quantidade: item.qtd,
        valor: item.preco,
      })),
      _Parcelas: [
        {
          forma: paymentType ? PAYMENT_MAP[paymentType] || 99 : 99,
          valor: totalVenda,
          vencimento: orderDate,
          obs: `Mercado Pago - ${paymentType || "desconhecido"}`,
        },
      ],
      _EnderecoDeEntrega: endereco || {},
      _Transportador: { nome: "Mercado Envios", formaFrete: 9 },
    };

    const result = await eccosys.post<{
      id?: number;
      numero?: string;
      [key: string]: unknown;
    }>("/pedidos", payload, workspaceId);

    // Extract ecc_pedido_id from response
    const eccPedidoId = result.id || null;
    const eccNumero = result.numero || null;

    // Update hub_orders
    await supabase
      .from("hub_orders")
      .update({
        ecc_pedido_id: eccPedidoId,
        ecc_numero: eccNumero,
        ecc_situacao: 0,
        sync_status: "imported",
        error_msg: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Log
    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "push_order_eccosys",
      entity: "order",
      entity_id: String(order.ml_order_id),
      direction: "hub_to_eccosys",
      status: "ok",
      details: {
        ecc_pedido_id: eccPedidoId,
        ecc_numero: eccNumero,
        items: skus.length,
      },
    });

    return NextResponse.json({
      ok: true,
      ecc_pedido_id: eccPedidoId,
      ecc_numero: eccNumero,
    });
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
