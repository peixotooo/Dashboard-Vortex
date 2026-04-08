import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { HubOrder, HubOrderItem, EccosysProduto } from "@/types/hub";

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
 * Push a hub order to Eccosys.
 * Returns the Eccosys pedido ID and numero on success.
 * Throws on error.
 */
export async function pushOrderToEccosys(
  order: HubOrder,
  workspaceId: string
): Promise<{ ecc_pedido_id: number | null; ecc_numero: string | null }> {
  const supabase = createAdminClient();

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
    // Not critical
  }

  // Build SKU → ecc_id map from hub_products (fast cache)
  const skus = (order.items || []).map((i) => i.sku);
  const skuToEccId = new Map<string, number>();
  if (skus.length > 0) {
    const { data: hubProducts } = await supabase
      .from("hub_products")
      .select("sku, ecc_id")
      .eq("workspace_id", workspaceId)
      .in("sku", skus)
      .not("ecc_id", "is", null);

    for (const p of (hubProducts || []) as Array<{ sku: string; ecc_id: number | null }>) {
      if (p.ecc_id) skuToEccId.set(p.sku, p.ecc_id);
    }
  }

  // Resolve idProduto for each item: try cache first, then Eccosys API directly
  async function resolveEccId(item: HubOrderItem): Promise<number | null> {
    const cached = skuToEccId.get(item.sku);
    if (cached) return cached;

    // Fallback: query Eccosys directly by SKU
    try {
      const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
        `/produtos/${encodeURIComponent(item.sku)}`,
        workspaceId
      );
      const prod = Array.isArray(result) ? result[0] : result;
      if (prod?.id) {
        console.log(`[push-order] Resolved ${item.sku} via Eccosys API: id=${prod.id}`);
        return prod.id;
      }
    } catch {
      // SKU not found in Eccosys
    }
    return null;
  }

  // Resolve all items in parallel and validate every one has idProduto
  const resolvedItems = await Promise.all(
    (order.items || []).map(async (item) => ({
      item,
      eccId: await resolveEccId(item),
    }))
  );

  const missingItems = resolvedItems.filter((r) => !r.eccId);
  if (missingItems.length > 0) {
    const missingSkus = missingItems.map((m) => m.item.sku).join(", ");
    throw new Error(
      `Produtos nao encontrados no Eccosys: ${missingSkus}. Cadastre os produtos antes de importar o pedido.`
    );
  }

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
    situacao: 0,
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
    _Itens: resolvedItems.map(({ item, eccId }) => ({
      codigo: item.sku,
      descricao: item.nome,
      quantidade: item.qtd,
      valor: item.preco,
      idProduto: eccId!, // guaranteed by validation above
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

  const result = await eccosys.post<Record<string, unknown>>(
    "/pedidos",
    payload,
    workspaceId
  );

  // Eccosys returns: { success: [{ id: 123, codigo: "ML-..." }], error: [] }
  let eccPedidoId: number | null = null;
  let eccNumero: string | null = null;

  if (result.success && Array.isArray(result.success) && result.success.length > 0) {
    const first = result.success[0] as Record<string, unknown>;
    eccPedidoId = (first.id as number) ?? null;
    eccNumero = (first.codigo as string) ?? null;
  } else {
    eccPedidoId = (result.id as number) ?? null;
    eccNumero = (result.numero as string) ?? (result.codigo as string) ?? null;
  }

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

  return { ecc_pedido_id: eccPedidoId, ecc_numero: eccNumero };
}
