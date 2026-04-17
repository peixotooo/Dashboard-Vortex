import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
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

// Cache Mercado Envios transportadora info (per workspace)
interface MercadoEnviosInfo {
  idTransportador: number;
  idVinculoTransportadora: number;
  codigo: string;
}
const mercadoEnviosCache = new Map<string, MercadoEnviosInfo | null>();

async function getMercadoEnviosInfo(workspaceId: string): Promise<MercadoEnviosInfo | null> {
  if (mercadoEnviosCache.has(workspaceId)) {
    return mercadoEnviosCache.get(workspaceId)!;
  }
  try {
    const result = await eccosys.get<unknown>("/transportadoras", workspaceId);
    const list = Array.isArray(result) ? result : [];
    const me = list.find((t: unknown) => {
      const obj = t as Record<string, unknown>;
      const nome = String(obj.nome || obj.razaoSocial || obj.fantasia || "");
      return /mercado\s*envios|mercado\s*livre/i.test(nome);
    });
    if (me) {
      const obj = me as Record<string, unknown>;
      const formas = (obj._FormasDeEnvio as Array<Record<string, unknown>>) || [];
      // Pick first active forma de envio (or just the first if none active)
      const formaAtiva = formas.find((f) => f.ativa === "S") || formas[0];
      const info: MercadoEnviosInfo = {
        idTransportador: Number(obj.id),
        idVinculoTransportadora: formaAtiva ? Number(formaAtiva.id) : 0,
        codigo: String(obj.codigo || ""),
      };
      console.log(`[push-order] Mercado Envios: ${JSON.stringify(info)}`);
      mercadoEnviosCache.set(workspaceId, info);
      return info;
    }
  } catch (err) {
    console.log(`[push-order] transportadoras lookup failed:`, err instanceof Error ? err.message : String(err));
  }
  mercadoEnviosCache.set(workspaceId, null);
  return null;
}

/**
 * Push a hub order to Eccosys.
 * Returns the Eccosys pedido ID and numero on success.
 * Throws on error.
 */
export async function pushOrderToEccosys(
  order: HubOrder,
  workspaceId: string
): Promise<{ ecc_pedido_id: number | null; ecc_numero: string | null; mercado_envios?: MercadoEnviosInfo | null }> {
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

  // Get Mercado Envios transportadora info from Eccosys
  const meInfo = await getMercadoEnviosInfo(workspaceId);

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

  const endereco = (order.endereco || {}) as Record<string, unknown>;
  let buyerDoc = (order.buyer_doc || "").replace(/\D/g, "");

  // If buyer_doc is missing (old order imported before billing_info fix),
  // fetch it now from ML and persist to hub_orders
  if (!buyerDoc) {
    try {
      const billing = await ml.get<{
        billing_info?: { doc_number?: string };
        doc_number?: string;
      }>(`/orders/${order.ml_order_id}/billing_info`, workspaceId);
      const fetched = (billing.billing_info?.doc_number || billing.doc_number || "").replace(/\D/g, "");
      if (fetched) {
        buyerDoc = fetched;
        await supabase
          .from("hub_orders")
          .update({ buyer_doc: fetched, updated_at: new Date().toISOString() })
          .eq("id", order.id);
        console.log(`[push-order] Fetched buyer_doc from ML for order ${order.ml_order_id}: ${fetched}`);
      }
    } catch (err) {
      console.log(`[push-order] billing_info fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const isCnpj = buyerDoc.length === 14;

  // Build address object for both _Contato and _EnderecoDeEntrega
  const enderecoBase = {
    endereco: (endereco.endereco as string) || "",
    numero: (endereco.numero as string) || "S/N",
    complemento: (endereco.complemento as string) || "",
    bairro: (endereco.bairro as string) || "",
    cep: ((endereco.cep as string) || "").replace(/\D/g, ""),
    cidade: (endereco.cidade as string) || "",
    uf: (endereco.uf as string) || "",
    estado: (endereco.estado as string) || "",
    pais: (endereco.pais as string) || "Brasil",
  };

  const payload = {
    data: orderDate,
    situacao: 0,
    totalProdutos,
    totalVenda,
    frete,
    // numeroPedido is auto-generated by Eccosys (sequential).
    // Eccosys truncates this field to ~10 chars, so passing ML- prefix
    // would make all orders have the same number ("ML-2000016...").
    // The full ML order id stays in numeroDaOrdemDeCompra (no truncation).
    numeroDaOrdemDeCompra: String(order.ml_order_id),
    ...(canalMlId ? { idCanalVenda: canalMlId } : {}),
    observacaoInterna: `Importado do ML - Pedido ${order.ml_order_id}`,
    _Contato: {
      nome: order.buyer_name || "Comprador ML",
      cnpj: buyerDoc,
      tipo: isCnpj ? "J" : "F",
      // identificadorIE: 9 = nao contribuinte (default for CPF and CNPJ sem IE)
      identificadorIE: 9,
      email: order.buyer_email || "",
      telefone: ((endereco.telefone as string) || "").replace(/\D/g, ""),
      ...enderecoBase,
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
    _EnderecoDeEntrega: enderecoBase,
    formaFrete: 9,
    ...(meInfo
      ? {
          idTransportador: meInfo.idTransportador,
          idVinculoTransportadora: meInfo.idVinculoTransportadora,
          codigoTransportador: meInfo.codigo,
          transportador: "MERCADO ENVIOS",
        }
      : { transportador: "Mercado Envios" }),
    _Transportador: {
      ...(meInfo ? { id: meInfo.idTransportador } : {}),
      nome: "MERCADO ENVIOS",
      formaFrete: 9,
    },
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

  return { ecc_pedido_id: eccPedidoId, ecc_numero: eccNumero, mercado_envios: meInfo };
}

/**
 * Push a PACK of ML orders as a SINGLE consolidated Eccosys order.
 * All orders in the pack share buyer + address + shipment. Their items
 * are concatenated and totals summed. Every hub_orders row in the pack
 * gets updated with the same ecc_pedido_id / ecc_numero.
 */
export async function pushPackToEccosys(
  orders: HubOrder[],
  workspaceId: string
): Promise<{ ecc_pedido_id: number | null; ecc_numero: string | null; orders_linked: number }> {
  if (orders.length === 0) {
    throw new Error("No orders in pack");
  }

  const supabase = createAdminClient();
  const first = orders[0];

  // Get canal ML + Mercado Envios info
  let canalMlId: number | null = null;
  try {
    const canais = await eccosys.get<
      Array<{ id: number; idMarketplace: number }>
    >("/canaisDeVenda", workspaceId);
    if (Array.isArray(canais)) {
      const mlCanal = canais.find((c) => c.idMarketplace === 3);
      if (mlCanal) canalMlId = mlCanal.id;
    }
  } catch { /* not critical */ }
  const meInfo = await getMercadoEnviosInfo(workspaceId);

  // Concatenate all items from all orders in the pack
  const allItems: HubOrderItem[] = orders.flatMap((o) => o.items || []);

  // Build SKU → ecc_id map from hub_products
  const skus = [...new Set(allItems.map((i) => i.sku))];
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

  async function resolveEccId(item: HubOrderItem): Promise<number | null> {
    const cached = skuToEccId.get(item.sku);
    if (cached) return cached;
    try {
      const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
        `/produtos/${encodeURIComponent(item.sku)}`,
        workspaceId
      );
      const prod = Array.isArray(result) ? result[0] : result;
      if (prod?.id) return prod.id;
    } catch { /* not found */ }
    return null;
  }

  const resolvedItems = await Promise.all(
    allItems.map(async (item) => ({ item, eccId: await resolveEccId(item) }))
  );

  const missingItems = resolvedItems.filter((r) => !r.eccId);
  if (missingItems.length > 0) {
    const missingSkus = missingItems.map((m) => m.item.sku).join(", ");
    throw new Error(
      `Produtos nao encontrados no Eccosys: ${missingSkus}. Cadastre os produtos antes de importar o pedido.`
    );
  }

  // Resolve buyer_doc from any order (prefer populated), fall back to ML billing_info
  let buyerDoc = "";
  for (const o of orders) {
    const d = (o.buyer_doc || "").replace(/\D/g, "");
    if (d) { buyerDoc = d; break; }
  }
  if (!buyerDoc) {
    try {
      const billing = await ml.get<{
        billing_info?: { doc_number?: string };
        doc_number?: string;
      }>(`/orders/${first.ml_order_id}/billing_info`, workspaceId);
      const fetched = (billing.billing_info?.doc_number || billing.doc_number || "").replace(/\D/g, "");
      if (fetched) {
        buyerDoc = fetched;
        // Persist on all orders in the pack
        await supabase
          .from("hub_orders")
          .update({ buyer_doc: fetched, updated_at: new Date().toISOString() })
          .in("id", orders.map((o) => o.id));
      }
    } catch { /* ignore */ }
  }

  const isCnpj = buyerDoc.length === 14;
  const endereco = (first.endereco || {}) as Record<string, unknown>;
  const enderecoBase = {
    endereco: (endereco.endereco as string) || "",
    numero: (endereco.numero as string) || "S/N",
    complemento: (endereco.complemento as string) || "",
    bairro: (endereco.bairro as string) || "",
    cep: ((endereco.cep as string) || "").replace(/\D/g, ""),
    cidade: (endereco.cidade as string) || "",
    uf: (endereco.uf as string) || "",
    estado: (endereco.estado as string) || "",
    pais: (endereco.pais as string) || "Brasil",
  };

  const orderDate = first.ml_date
    ? first.ml_date.split("T")[0]
    : new Date().toISOString().split("T")[0];
  const totalProdutos = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const frete = orders.reduce((s, o) => s + Number(o.frete || 0), 0);
  const totalVenda = totalProdutos + frete;

  const paymentType = (first.pagamento as Record<string, unknown>)?.tipo as string | undefined;
  const packId = first.ml_pack_id || first.ml_order_id;
  const orderIdsStr = orders.map((o) => o.ml_order_id).join(",");

  const payload = {
    data: orderDate,
    situacao: 0,
    totalProdutos,
    totalVenda,
    frete,
    numeroDaOrdemDeCompra: String(packId),
    ...(canalMlId ? { idCanalVenda: canalMlId } : {}),
    observacaoInterna: `Importado do ML - Pack ${packId} (${orders.length} pedidos: ${orderIdsStr})`,
    _Contato: {
      nome: first.buyer_name || "Comprador ML",
      cnpj: buyerDoc,
      tipo: isCnpj ? "J" : "F",
      identificadorIE: 9,
      email: first.buyer_email || "",
      telefone: ((endereco.telefone as string) || "").replace(/\D/g, ""),
      ...enderecoBase,
    },
    _Itens: resolvedItems.map(({ item, eccId }) => ({
      codigo: item.sku,
      descricao: item.nome,
      quantidade: item.qtd,
      valor: item.preco,
      idProduto: eccId!,
    })),
    _Parcelas: [
      {
        forma: paymentType ? PAYMENT_MAP[paymentType] || 99 : 99,
        valor: totalVenda,
        vencimento: orderDate,
        obs: `Mercado Pago - ${paymentType || "desconhecido"}`,
      },
    ],
    _EnderecoDeEntrega: enderecoBase,
    formaFrete: 9,
    ...(meInfo
      ? {
          idTransportador: meInfo.idTransportador,
          idVinculoTransportadora: meInfo.idVinculoTransportadora,
          codigoTransportador: meInfo.codigo,
          transportador: "MERCADO ENVIOS",
        }
      : { transportador: "Mercado Envios" }),
    _Transportador: {
      ...(meInfo ? { id: meInfo.idTransportador } : {}),
      nome: "MERCADO ENVIOS",
      formaFrete: 9,
    },
  };

  const result = await eccosys.post<Record<string, unknown>>("/pedidos", payload, workspaceId);

  let eccPedidoId: number | null = null;
  let eccNumero: string | null = null;
  if (result.success && Array.isArray(result.success) && result.success.length > 0) {
    const firstResult = result.success[0] as Record<string, unknown>;
    eccPedidoId = (firstResult.id as number) ?? null;
    eccNumero = (firstResult.codigo as string) ?? null;
  }

  if (!eccPedidoId) {
    throw new Error(`Eccosys nao retornou id do pedido: ${JSON.stringify(result).slice(0, 400)}`);
  }

  // Link every order in the pack to the same Eccosys order
  const now = new Date().toISOString();
  await supabase
    .from("hub_orders")
    .update({
      ecc_pedido_id: eccPedidoId,
      ecc_numero: eccNumero,
      ecc_situacao: 0,
      sync_status: "imported",
      error_msg: null,
      updated_at: now,
    })
    .in("id", orders.map((o) => o.id));

  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "push_order_eccosys",
    entity: "order",
    entity_id: String(packId),
    direction: "hub_to_eccosys",
    status: "ok",
    details: {
      pack: true,
      ml_pack_id: packId,
      orders_linked: orders.length,
      items: resolvedItems.length,
      ecc_pedido_id: eccPedidoId,
      ecc_numero: eccNumero,
    },
  });

  return { ecc_pedido_id: eccPedidoId, ecc_numero: eccNumero, orders_linked: orders.length };
}
