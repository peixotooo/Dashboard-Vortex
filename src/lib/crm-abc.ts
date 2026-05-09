// src/lib/crm-abc.ts
//
// ABC curve (Pareto) + per-order profitability over the workspace's
// crm_vendas data. Pure compute functions — no Supabase calls. The
// orchestration (load rows + load product_costs + persist snapshot)
// lives in crm-compute.ts so this file stays unit-testable.
//
// What the ABC pieces give us:
//   1. ABC class per product (A = top 70% revenue, B = next 20%, C =
//      tail 10%) — used by the bestseller picker as a stability signal
//      ("trending right now AND a real revenue driver"), and by the
//      reports dashboard.
//   2. Per-order profit estimate — revenue minus cost (tracked or
//      estimated via default margin) minus payment fee minus the
//      shipping margin (what we charged minus what we likely paid the
//      carrier). Lets the user see which orders actually made money,
//      not just which were big.

import type { CrmVendaRow } from "./crm-rfm";

export type AbcClass = "A" | "B" | "C";

export interface ProductCostEntry {
  sku: string;
  cost: number;
}

export interface AbcProductRow {
  sku: string | null;
  product_id: string | null;
  name: string;
  qty_sold: number;
  revenue: number;
  cost_unit: number;
  cost_total: number;
  profit: number;
  margin_pct: number;
  abc_class: AbcClass;
  cumulative_revenue_pct: number;
  /** "tracked" = product_costs had this SKU; "estimated" = fallback to
   *  the workspace default margin. UI can flag estimated rows so the
   *  user knows which numbers are guesses. */
  cost_source: "tracked" | "estimated";
}

export interface OrderProfitabilityRow {
  order_id: string | null;
  numero_pedido: string | null;
  customer_email: string | null;
  data_compra: string | null;
  valor: number;
  items_revenue: number;
  items_cost: number;
  fees_estimated: number;
  shipping_diff: number;
  discount_total: number;
  profit: number;
  margin_pct: number;
  status: "profit" | "loss" | "breakeven";
}

export interface AbcSummary {
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  gross_margin_pct: number;
  a_count: number;
  b_count: number;
  c_count: number;
  profitable_orders: number;
  loss_orders: number;
  breakeven_orders: number;
  period_start: string | null;
  period_end: string | null;
  /** Fração de revenue cujo SKU está em product_costs (tracked) vs
   *  estimado pela margem default. Sinaliza o quanto o usuário pode
   *  confiar no número de "lucro real". */
  coverage_pct: number;
}

export interface AbcResult {
  products: AbcProductRow[];
  orders: OrderProfitabilityRow[];
  summary: AbcSummary;
}

interface ComputeOpts {
  /** Margem default usada quando product_costs não tem o SKU
   *  (0.0..1.0). Vem de email_template_settings.default_margin_pct. */
  defaultMarginPct: number;
}

interface ItemRow {
  sku?: string | null;
  reference?: string | null;
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
  total?: number | null;
}

function toItems(row: CrmVendaRow): ItemRow[] {
  return Array.isArray(row.items) ? (row.items as ItemRow[]) : [];
}

/** Estimativa de taxa de gateway por método de pagamento. Valores médios
 *  do mercado BR — o usuário pode sobrescrever no futuro via uma config
 *  por workspace. Não é receita perdida exata, é estimativa de custo
 *  pra cálculo de lucratividade.
 *
 *  Pix: 0.99% típico (Cielo/PagSeguro/etc).
 *  Cartão à vista: 3.99% (varia por adquirente).
 *  Cartão parcelado: 4.99% baseline + ~1% por parcela acima de 1.
 *  Boleto: R$ 3.49 fixo aproximado.
 *  Default: 4% se método desconhecido. */
function estimatePaymentFee(
  total: number,
  method: string | null | undefined,
  installments: number | null | undefined
): number {
  if (total <= 0) return 0;
  const m = (method ?? "").toLowerCase();
  if (m.includes("pix")) return total * 0.0099;
  if (m.includes("boleto")) return 3.49;
  if (m.includes("debit") || m.includes("débito")) return total * 0.0249;
  if (m.includes("credit") || m.includes("crédito") || m.includes("cart")) {
    const inst = Math.max(1, Number(installments ?? 1));
    const baseRate = 0.0399;
    const installmentSurcharge = inst > 1 ? (inst - 1) * 0.01 : 0;
    return total * (baseRate + installmentSurcharge);
  }
  return total * 0.04;
}

/** Diferença de frete: o que cobramos do cliente vs estimativa do que
 *  pagamos ao carrier. Sem dado externo, assumimos que a transportadora
 *  cobra ~85% do preço cobrado (margem média de 15% sobre frete pra
 *  marketplaces). Se shipping_price = 0 (frete grátis), o custo
 *  estimado vira zero também — a opção é o lojista absorver internamente
 *  ou repassar pro produto, e sem dado externo a melhor estimativa é 0. */
function estimateShippingDiff(shippingPrice: number | null | undefined): number {
  if (!shippingPrice || shippingPrice <= 0) return 0;
  // Negativo = custo (o que pagamos > o que cobramos seria positivo;
  // como cobramos mais do que pagamos, fica negativo aqui significa
  // que existe MARGEM positiva — confusing. Vamos retornar a margem
  // POSITIVA = receita - custo do carrier).
  const carrierCost = shippingPrice * 0.85;
  return shippingPrice - carrierCost; // pequeno positivo
}

/**
 * Curva ABC + lucratividade por order numa única passada sobre as rows
 * de crm_vendas. O custo por SKU vem do mapa `costsBySku` (lowercased
 * keys); SKUs sem entrada usam a margem default.
 *
 * Pareto cutoffs: A ≤ 70% acumulado de revenue, B ≤ 90%, C >90%. Esses
 * cortes são o padrão de mercado pra ABC e dão uma classificação
 * intuitiva (A = poucos drivers que carregam o negócio, C = cauda
 * longa).
 */
export function computeAbcAndProfitability(
  rows: CrmVendaRow[],
  costsBySku: Map<string, number>,
  opts: ComputeOpts
): AbcResult {
  // 1. Agregar por produto (sku como chave primária; product_id como
  //    fallback secundário pra catálogos sem SKU).
  type ProductAgg = {
    sku: string | null;
    product_id: string | null;
    name: string;
    qty_sold: number;
    revenue: number;
    cost_total: number;
    cost_source: "tracked" | "estimated";
  };
  const productMap = new Map<string, ProductAgg>();

  // 2. Per-order profitability (computado em paralelo).
  const orders: OrderProfitabilityRow[] = [];

  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (const row of rows) {
    const items = toItems(row);
    if (items.length === 0 && row.valor == null) continue;

    if (row.data_compra) {
      if (!periodStart || row.data_compra < periodStart) periodStart = row.data_compra;
      if (!periodEnd || row.data_compra > periodEnd) periodEnd = row.data_compra;
    }

    let orderItemsRevenue = 0;
    let orderItemsCost = 0;

    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity ?? 1));
      const lineRevenue = Number(item.total ?? (item.price ?? 0) * qty);
      const skuKey = (item.sku ?? "").trim().toLowerCase();
      const productKey = skuKey || (item.reference ?? "").trim().toLowerCase() || `n_${item.name ?? "unknown"}`;

      // Resolver custo: 1) tracked via product_costs, 2) estimado pela
      // margem default sobre price/qty.
      const trackedCost = skuKey ? costsBySku.get(skuKey) : undefined;
      let costUnit: number;
      let costSource: "tracked" | "estimated";
      if (trackedCost != null) {
        costUnit = trackedCost;
        costSource = "tracked";
      } else {
        const unitPrice = Number(item.price ?? lineRevenue / qty);
        costUnit = Math.max(0, unitPrice * (1 - opts.defaultMarginPct));
        costSource = "estimated";
      }
      const lineCost = costUnit * qty;

      orderItemsRevenue += lineRevenue;
      orderItemsCost += lineCost;

      // Aggregate per produto.
      const existing = productMap.get(productKey);
      if (existing) {
        existing.qty_sold += qty;
        existing.revenue += lineRevenue;
        existing.cost_total += lineCost;
        // Se algum item desse SKU vem tracked, o agregado conta como
        // tracked (mais confiável que misturar fontes silenciosamente).
        if (costSource === "tracked") existing.cost_source = "tracked";
      } else {
        productMap.set(productKey, {
          sku: item.sku ?? null,
          product_id: item.reference ?? null,
          name: item.name ?? "(sem nome)",
          qty_sold: qty,
          revenue: lineRevenue,
          cost_total: lineCost,
          cost_source: costSource,
        });
      }
    }

    // Order-level profit: revenue real do order menos custo dos itens
    // menos taxa de pagamento estimada mais margem de frete.
    const orderTotal = Number(row.valor ?? orderItemsRevenue);
    const fees = estimatePaymentFee(
      orderTotal,
      row.payment_method,
      row.installments
    );
    const shippingDiff = estimateShippingDiff(row.shipping_price);
    const discount = Number(row.discount_price ?? 0);
    const profit = orderItemsRevenue - orderItemsCost - fees + shippingDiff;
    const marginPct = orderTotal > 0 ? profit / orderTotal : 0;
    const status: OrderProfitabilityRow["status"] =
      profit > 0.5 ? "profit" : profit < -0.5 ? "loss" : "breakeven";

    orders.push({
      order_id: row.numero_pedido ?? row.source_order_id ?? null,
      numero_pedido: row.numero_pedido ?? null,
      customer_email: row.email ?? null,
      data_compra: row.data_compra ?? null,
      valor: orderTotal,
      items_revenue: round2(orderItemsRevenue),
      items_cost: round2(orderItemsCost),
      fees_estimated: round2(fees),
      shipping_diff: round2(shippingDiff),
      discount_total: round2(discount),
      profit: round2(profit),
      margin_pct: round2(marginPct),
      status,
    });
  }

  // 3. Sort por revenue desc e classifica ABC via Pareto.
  const allProducts = [...productMap.values()].sort(
    (a, b) => b.revenue - a.revenue
  );
  const totalRevenue = allProducts.reduce((s, p) => s + p.revenue, 0);

  const products: AbcProductRow[] = [];
  let cumulative = 0;
  for (const p of allProducts) {
    cumulative += p.revenue;
    const cumPct = totalRevenue > 0 ? cumulative / totalRevenue : 0;
    let abcClass: AbcClass;
    if (cumPct <= 0.7) abcClass = "A";
    else if (cumPct <= 0.9) abcClass = "B";
    else abcClass = "C";

    const profit = p.revenue - p.cost_total;
    const margin = p.revenue > 0 ? profit / p.revenue : 0;

    products.push({
      sku: p.sku,
      product_id: p.product_id,
      name: p.name,
      qty_sold: p.qty_sold,
      revenue: round2(p.revenue),
      cost_unit: p.qty_sold > 0 ? round2(p.cost_total / p.qty_sold) : 0,
      cost_total: round2(p.cost_total),
      profit: round2(profit),
      margin_pct: round2(margin),
      abc_class: abcClass,
      cumulative_revenue_pct: round2(cumPct),
      cost_source: p.cost_source,
    });
  }

  // 4. Summary.
  const totalCost = products.reduce((s, p) => s + p.cost_total, 0);
  const totalProfit = totalRevenue - totalCost;
  const trackedRevenue = products
    .filter((p) => p.cost_source === "tracked")
    .reduce((s, p) => s + p.revenue, 0);
  const summary: AbcSummary = {
    total_revenue: round2(totalRevenue),
    total_cost: round2(totalCost),
    total_profit: round2(totalProfit),
    gross_margin_pct: totalRevenue > 0 ? round2(totalProfit / totalRevenue) : 0,
    a_count: products.filter((p) => p.abc_class === "A").length,
    b_count: products.filter((p) => p.abc_class === "B").length,
    c_count: products.filter((p) => p.abc_class === "C").length,
    profitable_orders: orders.filter((o) => o.status === "profit").length,
    loss_orders: orders.filter((o) => o.status === "loss").length,
    breakeven_orders: orders.filter((o) => o.status === "breakeven").length,
    period_start: periodStart,
    period_end: periodEnd,
    coverage_pct: totalRevenue > 0 ? round2(trackedRevenue / totalRevenue) : 0,
  };

  return { products, orders, summary };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
