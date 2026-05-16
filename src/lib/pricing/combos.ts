// Cálculos derivados do combo (Conceito 8 do SDD).
//
// - ticket_medio_combo: preço fixo / combo_size
// - cpa_breakeven: lucro_unitario_combo × combo_size = margem disponível pra
//   absorver custo de aquisição. Quando ROI mínimo do canal > cpa_breakeven,
//   o combo não faz a conta fechar.
// - cobertura_estoque_dias: limitada pelo SKU mais escasso (estoque mínimo
//   dividido pelo ritmo de venda projetado).

import type { SupabaseClient } from "@supabase/supabase-js";

export type ComboMetrics = {
  ticket_medio_brl: number;
  cpa_breakeven_brl: number | null;
  cobertura_estoque_dias: number | null;
  estoque_minimo_unidades: number | null;
  sku_mais_escasso: string | null;
};

export async function computeComboMetrics(
  client: SupabaseClient,
  workspaceId: string,
  comboPriceBrl: number,
  comboSize: number,
  skuIds: string[]
): Promise<ComboMetrics> {
  if (skuIds.length === 0 || comboSize <= 0) {
    return {
      ticket_medio_brl: 0,
      cpa_breakeven_brl: null,
      cobertura_estoque_dias: null,
      estoque_minimo_unidades: null,
      sku_mais_escasso: null,
    };
  }

  const ticket = comboPriceBrl / comboSize;

  // Carrega composição dos SKUs participantes pra calcular custo médio
  const { data: pricing } = await client
    .from("sku_pricing")
    .select(
      "sku, frete_unitario, marketing_unitario, rateio_fixo, taxas_comissoes_pct, impostos_pct"
    )
    .eq("workspace_id", workspaceId)
    .in("sku", skuIds);

  const { data: costs } = await client
    .from("product_costs")
    .select("sku, cost")
    .eq("workspace_id", workspaceId)
    .in("sku", skuIds);

  const costMap = new Map<string, number>();
  for (const c of costs ?? []) costMap.set((c as any).sku, Number((c as any).cost));

  let custoTotal = 0;
  let impostosPctAvg = 0;
  let taxasPctAvg = 0;
  let counted = 0;
  for (const p of pricing ?? []) {
    const r = p as any;
    const cogs = costMap.get(r.sku) ?? 0;
    custoTotal +=
      cogs +
      Number(r.frete_unitario ?? 0) +
      Number(r.marketing_unitario ?? 0) +
      Number(r.rateio_fixo ?? 0);
    impostosPctAvg += Number(r.impostos_pct ?? 0);
    taxasPctAvg += Number(r.taxas_comissoes_pct ?? 0);
    counted += 1;
  }
  if (counted > 0) {
    impostosPctAvg /= counted;
    taxasPctAvg /= counted;
  }

  const cpa =
    counted > 0
      ? comboPriceBrl - custoTotal - comboPriceBrl * impostosPctAvg - comboPriceBrl * taxasPctAvg
      : null;

  // Cobertura: estoque mínimo entre SKUs / venda média (combo consome 1 unidade
  // de cada por execução, ou combo_size do mesmo SKU). Simplificação: assume
  // que cada combo consome combo_size unidades distribuídas — usamos o SKU
  // com estoque mais baixo dividido por combo_size pra estimar ciclos.
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: snapshots } = await client
    .from("sku_pricing_history")
    .select("sku, stock_units, vendas_dia_unidades, snapshot_date")
    .eq("workspace_id", workspaceId)
    .in("sku", skuIds)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: false });

  const latest = new Map<string, { stock: number; vendas: number }>();
  for (const s of snapshots ?? []) {
    const r = s as any;
    if (!latest.has(r.sku)) {
      latest.set(r.sku, {
        stock: Number(r.stock_units ?? 0),
        vendas: Number(r.vendas_dia_unidades ?? 0),
      });
    }
  }

  let minCobertura: number | null = null;
  let menorEstoque: number | null = null;
  let escasso: string | null = null;
  for (const sku of skuIds) {
    const m = latest.get(sku);
    if (!m) continue;
    if (menorEstoque == null || m.stock < menorEstoque) {
      menorEstoque = m.stock;
      escasso = sku;
    }
    if (m.vendas > 0) {
      const cob = Math.round(m.stock / m.vendas);
      if (minCobertura == null || cob < minCobertura) minCobertura = cob;
    }
  }

  return {
    ticket_medio_brl: ticket,
    cpa_breakeven_brl: cpa != null ? Math.max(0, cpa) : null,
    cobertura_estoque_dias: minCobertura,
    estoque_minimo_unidades: menorEstoque,
    sku_mais_escasso: escasso,
  };
}
