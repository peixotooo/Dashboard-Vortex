// src/lib/financeiro/abc.ts
//
// ABC curve (Pareto) + per-order profitability.
//
// Replaces the legacy lib/crm-abc.ts. Two structural changes from the
// first cut:
//
//   1. Lives under lib/financeiro/ because ABC is operational/financial
//      analysis, not customer-relationship analysis. CRM stays focused
//      on segmentation; financeiro owns ABC, profitability,
//      contribution margin etc.
//
//   2. Pulls real cost/tax/freight rates from workspace_financial_
//      settings instead of hardcoding payment-fee estimates. This
//      matches what the commercial simulator (lib/commercial-simulator/
//      calculate.ts) already uses for margin verdicts, so ABC and
//      simulator agree on what "lucro" means.
//
// Margin-of-contribution formula (canonical to this codebase):
//
//   precoLiquido    = revenue (já net de desconto, vem do crm_vendas.valor)
//   cmv             = product_costs.cost × qty   (tracked)
//                   OR revenue × product_cost_pct (fallback)
//   impostos        = revenue × tax_pct
//   outras_despesas = revenue × other_expenses_pct
//   frete_absorvido = (shipping_price == 0) ? custo_frete_medio : 0
//   profit          = revenue - cmv - impostos - outras_despesas - frete_absorvido

import type { CrmVendaRow } from "@/lib/crm-rfm";

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
  taxes: number;
  other_expenses: number;
  shipping_absorbed: number;
  discount_total: number;
  profit: number;
  margin_pct: number;
  status: "profit" | "loss" | "breakeven";
}

export interface AbcSummary {
  total_revenue: number;
  total_cost: number;
  total_taxes: number;
  total_other_expenses: number;
  total_shipping_absorbed: number;
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
   *  estimado pela margem default. Sinaliza confiabilidade. */
  coverage_pct: number;
}

export interface AbcResult {
  products: AbcProductRow[];
  orders: OrderProfitabilityRow[];
  summary: AbcSummary;
}

/** Subset of workspace_financial_settings that we care about for ABC.
 *  Mirrors the columns the commercial-simulator already reads, so both
 *  produce consistent margin numbers. */
export interface FinancialSettings {
  /** % do preço considerado custo de produto (CMV) quando product_costs
   *  não tem o SKU. Default 25 = "25% do preço é custo". */
  product_cost_pct: number;
  /** % do preço aplicada como impostos sobre cada venda. */
  tax_pct: number;
  /** % do preço aplicada como outras despesas operacionais variáveis. */
  other_expenses_pct: number;
  /** Custo médio de frete em BRL absorvido pela loja quando o cliente
   *  ganhou frete grátis. */
  custo_frete_medio_brl: number;
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

/**
 * Deriva o "produto pai" de um item de pedido. A curva ABC agrupa por
 * pai — não faz sentido listar 5 variantes de cor da mesma camiseta
 * separadamente quando o usuário quer entender quais produtos puxam
 * receita.
 *
 * VNDA preenche os dois (sku e reference) no nível da variante:
 *   sku       = "256392812-4"
 *   reference = "256392812-4"  (ou similar com sufixo)
 *
 * Pra recuperar o pai, sempre removemos o sufixo "-NNNN" do final.
 * SKU é a fonte primária (formato consistente entre tenants); o
 * reference só serve de fallback quando SKU está vazio.
 */
function aggregationKey(item: ItemRow): {
  key: string;
  displayCode: string | null;
  productId: string | null;
} {
  const sku = (item.sku ?? "").trim();
  const ref = (item.reference ?? "").trim();
  const name = (item.name ?? "").trim();

  const stripVariantSuffix = (s: string): string => {
    const m = s.match(/^(.+)-(\d{1,5})$/);
    return m ? m[1] : s;
  };

  const skuParent = sku ? stripVariantSuffix(sku) : "";
  const refParent = ref ? stripVariantSuffix(ref) : "";

  const parent = skuParent || refParent;
  const key = (parent || (name ? `n_${name.toLowerCase()}` : "n_unknown")).toLowerCase();
  const displayCode = parent || sku || ref || null;
  const productId = parent || null;

  return { key, displayCode, productId };
}

/**
 * Single-pass ABC + profitability over crm_vendas rows.
 *
 *   - Per-product aggregation keyed by SKU (falls back to product_id
 *     if the workspace doesn't track SKUs cleanly).
 *   - Per-order P&L using the canonical margin-of-contribution formula
 *     from financial-settings.
 *   - Pareto cutoffs: A ≤ 70% cumulative revenue, B ≤ 90%, C >90%.
 */
export function computeAbcAndProfitability(
  rows: CrmVendaRow[],
  costsBySku: Map<string, number>,
  financial: FinancialSettings
): AbcResult {
  // pct fields come from a UI that stores them as 0..100 (not 0..1).
  // Normalize once to fractions.
  const productCostFrac = clamp(financial.product_cost_pct / 100, 0, 1);
  const taxFrac = clamp(financial.tax_pct / 100, 0, 1);
  const otherFrac = clamp(financial.other_expenses_pct / 100, 0, 1);
  const freteAbsorvidoMedio = Math.max(0, financial.custo_frete_medio_brl);

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
      const { key: parentKey, displayCode, productId } = aggregationKey(item);

      // Custo: tenta variante (sku exato), depois pai (parentKey),
      // senão fallback pra product_cost_pct sobre lineRevenue.
      // Tenants podem cadastrar custo no nível do pai ou da variante.
      let trackedCost: number | undefined;
      if (skuKey && costsBySku.has(skuKey)) {
        trackedCost = costsBySku.get(skuKey);
      } else if (parentKey && costsBySku.has(parentKey)) {
        trackedCost = costsBySku.get(parentKey);
      }
      let costUnit: number;
      let costSource: "tracked" | "estimated";
      if (trackedCost != null) {
        costUnit = trackedCost;
        costSource = "tracked";
      } else {
        const unitPrice = Number(item.price ?? lineRevenue / qty);
        costUnit = unitPrice * productCostFrac;
        costSource = "estimated";
      }
      const lineCost = costUnit * qty;

      orderItemsRevenue += lineRevenue;
      orderItemsCost += lineCost;

      const existing = productMap.get(parentKey);
      if (existing) {
        existing.qty_sold += qty;
        existing.revenue += lineRevenue;
        existing.cost_total += lineCost;
        // Pai vira "estimated" se QUALQUER variante caiu no fallback —
        // assim o usuário sabe que o número não é 100% rastreado.
        if (costSource === "estimated") existing.cost_source = "estimated";
      } else {
        productMap.set(parentKey, {
          sku: displayCode,
          product_id: productId,
          name: item.name ?? "(sem nome)",
          qty_sold: qty,
          revenue: lineRevenue,
          cost_total: lineCost,
          cost_source: costSource,
        });
      }
    }

    // Order-level P&L. Mirrors lib/commercial-simulator/calculate.ts:
    // taxes + outras_despesas incidem sobre o precoLiquido (revenue),
    // frete absorvido só conta se foi frete grátis (shipping_price == 0).
    const orderTotal = Number(row.valor ?? orderItemsRevenue);
    const taxes = orderTotal * taxFrac;
    const otherExpenses = orderTotal * otherFrac;
    const shippingPrice = Number(row.shipping_price ?? 0);
    const shippingAbsorbed = shippingPrice <= 0 ? freteAbsorvidoMedio : 0;
    const discount = Number(row.discount_price ?? 0);

    const profit =
      orderItemsRevenue - orderItemsCost - taxes - otherExpenses - shippingAbsorbed;
    const marginPct = orderTotal > 0 ? profit / orderTotal : 0;
    const status: OrderProfitabilityRow["status"] =
      profit > 0.5 ? "profit" : profit < -0.5 ? "loss" : "breakeven";

    orders.push({
      order_id: row.numero_pedido ?? row.source_order_id ?? null,
      numero_pedido: row.numero_pedido ?? null,
      customer_email: row.email ?? null,
      data_compra: row.data_compra ?? null,
      valor: round2(orderTotal),
      items_revenue: round2(orderItemsRevenue),
      items_cost: round2(orderItemsCost),
      taxes: round2(taxes),
      other_expenses: round2(otherExpenses),
      shipping_absorbed: round2(shippingAbsorbed),
      discount_total: round2(discount),
      profit: round2(profit),
      margin_pct: round4(marginPct),
      status,
    });
  }

  // Pareto sort + classify.
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
      margin_pct: round4(margin),
      abc_class: abcClass,
      cumulative_revenue_pct: round4(cumPct),
      cost_source: p.cost_source,
    });
  }

  // Summary roll-up (sum the per-order rows so the totals match exactly
  // what the user will see in the orders table).
  const totalProductCost = products.reduce((s, p) => s + p.cost_total, 0);
  const totalTaxes = orders.reduce((s, o) => s + o.taxes, 0);
  const totalOther = orders.reduce((s, o) => s + o.other_expenses, 0);
  const totalShipping = orders.reduce((s, o) => s + o.shipping_absorbed, 0);
  const totalProfit = orders.reduce((s, o) => s + o.profit, 0);

  const trackedRevenue = products
    .filter((p) => p.cost_source === "tracked")
    .reduce((s, p) => s + p.revenue, 0);

  const summary: AbcSummary = {
    total_revenue: round2(totalRevenue),
    total_cost: round2(totalProductCost),
    total_taxes: round2(totalTaxes),
    total_other_expenses: round2(totalOther),
    total_shipping_absorbed: round2(totalShipping),
    total_profit: round2(totalProfit),
    gross_margin_pct: totalRevenue > 0 ? round4(totalProfit / totalRevenue) : 0,
    a_count: products.filter((p) => p.abc_class === "A").length,
    b_count: products.filter((p) => p.abc_class === "B").length,
    c_count: products.filter((p) => p.abc_class === "C").length,
    profitable_orders: orders.filter((o) => o.status === "profit").length,
    loss_orders: orders.filter((o) => o.status === "loss").length,
    breakeven_orders: orders.filter((o) => o.status === "breakeven").length,
    period_start: periodStart,
    period_end: periodEnd,
    coverage_pct: totalRevenue > 0 ? round4(trackedRevenue / totalRevenue) : 0,
  };

  return { products, orders, summary };
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pra frações usadas como % no UI (margem, cobertura, %acumulado).
 *  4 casas no número = 2 casas após multiplicar por 100. round2 numa
 *  fração 0.0262 viraria 0.03 (3.0%) — round4 preserva como 0.0262 (2.6%). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
