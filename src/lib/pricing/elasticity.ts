// Simulador de elasticidade (Conceito 2 do SDD).
//
// Premissa: a curva demanda × preço é diferente por canal. O sistema estima
// um coeficiente de elasticidade por (sku, canal) via regressão log-log nas
// vendas dos últimos 90 dias agregadas por semana. Com menos de 4 pontos,
// devolve fallback -1.2 (moda/e-commerce típico).
//
// elasticidade = ∂log(qty) / ∂log(price). Coeficiente < 0 = demanda cai
// quando preço sobe. Quanto mais negativo, mais elástico (site costuma ser
// -1.5 a -2.0; loja física -0.3 a -0.8).
//
// Como o histórico de preço por (sku, canal, semana) não está persistido com
// granularidade suficiente, derivamos: price_observado = revenue / qty na
// semana. Não é o preço de tabela, mas captura o preço efetivamente pago.

import type { SupabaseClient } from "@supabase/supabase-js";

const FALLBACK_ELASTICITY = -1.2;
const MIN_POINTS = 4;

type VendaItem = {
  sku?: string;
  reference?: string;
  quantity?: number;
  price?: number;
  total?: number;
};

type WeeklyPoint = {
  week: string;
  channel: string;
  qty: number;
  revenue: number;
  price: number; // revenue / qty
};

export type ChannelElasticity = {
  channel: string;
  coefficient: number; // elasticidade observada
  is_fallback: boolean;
  points: number;
  recent_avg_price: number;
  recent_avg_qty: number;
};

export type ScenarioInput = {
  preco: number;
};

export type ScenarioOutput = {
  preco: number;
  demanda_esperada: number;
  lucro_unitario: number | null;
  lucro_total: number | null;
};

function weekKey(iso: string): string {
  const d = new Date(iso);
  // ISO week start = Monday
  const day = d.getUTCDay() || 7;
  const monday = new Date(d.getTime() - (day - 1) * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

// Regressão linear simples y = a + b*x. Retorna b (slope).
function linearSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export async function computeElasticityBySku(
  client: SupabaseClient,
  workspaceId: string,
  sku: string,
  days: number = 90
): Promise<{ channels: ChannelElasticity[]; points_used: WeeklyPoint[] }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await client
    .from("crm_vendas")
    .select("data_compra, canal, items")
    .eq("workspace_id", workspaceId)
    .gte("data_compra", since);

  // Aggregate by (channel, week)
  const buckets = new Map<string, { channel: string; week: string; qty: number; revenue: number }>();

  for (const row of data ?? []) {
    const r = row as any;
    if (!r.data_compra || !Array.isArray(r.items)) continue;
    const week = weekKey(r.data_compra);
    const channel = (r.canal ?? "desconhecido").toString();
    for (const item of r.items as VendaItem[]) {
      const skuMatch = (item.sku ?? item.reference ?? "").toString();
      if (skuMatch !== sku) continue;
      const qty = Number(item.quantity ?? 0);
      const price = Number(item.price ?? 0);
      const total = Number(item.total ?? qty * price);
      if (qty <= 0 || total <= 0) continue;
      const key = `${channel}::${week}`;
      const cur = buckets.get(key) ?? { channel, week, qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += total;
      buckets.set(key, cur);
    }
  }

  const points: WeeklyPoint[] = Array.from(buckets.values()).map((b) => ({
    ...b,
    price: b.qty > 0 ? b.revenue / b.qty : 0,
  }));

  const byChannel = new Map<string, WeeklyPoint[]>();
  for (const p of points) {
    if (!byChannel.has(p.channel)) byChannel.set(p.channel, []);
    byChannel.get(p.channel)!.push(p);
  }

  const channels: ChannelElasticity[] = [];
  for (const [channel, pts] of byChannel) {
    const validPts = pts.filter((p) => p.price > 0 && p.qty > 0);
    if (validPts.length < MIN_POINTS) {
      const avgPrice = validPts.length > 0
        ? validPts.reduce((a, p) => a + p.price, 0) / validPts.length
        : 0;
      const avgQty = validPts.length > 0
        ? validPts.reduce((a, p) => a + p.qty, 0) / validPts.length
        : 0;
      channels.push({
        channel,
        coefficient: FALLBACK_ELASTICITY,
        is_fallback: true,
        points: validPts.length,
        recent_avg_price: avgPrice,
        recent_avg_qty: avgQty,
      });
      continue;
    }
    const xs = validPts.map((p) => Math.log(p.price));
    const ys = validPts.map((p) => Math.log(p.qty));
    const slope = linearSlope(xs, ys);
    const avgPrice = validPts.reduce((a, p) => a + p.price, 0) / validPts.length;
    const avgQty = validPts.reduce((a, p) => a + p.qty, 0) / validPts.length;
    channels.push({
      channel,
      coefficient: slope != null && Number.isFinite(slope) ? slope : FALLBACK_ELASTICITY,
      is_fallback: slope == null || !Number.isFinite(slope),
      points: validPts.length,
      recent_avg_price: avgPrice,
      recent_avg_qty: avgQty,
    });
  }

  return { channels, points_used: points };
}

// Dado um cenário de preço e a elasticidade observada, projeta a demanda
// esperada: qty_nova = qty_ref × (preco_novo / preco_ref) ^ elasticidade
export function projectDemand(
  precoNovo: number,
  precoRef: number,
  qtyRef: number,
  elasticidade: number
): number {
  if (precoRef <= 0 || qtyRef <= 0) return 0;
  return qtyRef * Math.pow(precoNovo / precoRef, elasticidade);
}
