// Agregações analíticas do módulo de Pricing (Conceitos 6 e 7 do SDD).
//
// Constrói:
//   - KPIs gerais (% estoque ≤120d, margem média ponderada, desconto médio,
//     SKUs em markdown/markup)
//   - Matriz Idade × Margem (Conceito 7) — buckets fixos do SDD
//   - Matriz Trava × Desconto 3×3 (Conceito 6) — sinaliza saúde por célula

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineSettings } from "./types";

export const IDADE_BUCKETS = [
  { label: "1-15", min: 0, max: 15 },
  { label: "16-30", min: 16, max: 30 },
  { label: "31-45", min: 31, max: 45 },
  { label: "46-60", min: 46, max: 60 },
  { label: "61-75", min: 61, max: 75 },
  { label: "76-90", min: 76, max: 90 },
  { label: "91-105", min: 91, max: 105 },
  { label: "106-120", min: 106, max: 120 },
  { label: "121+", min: 121, max: Infinity },
];

type SnapshotRow = {
  sku: string;
  idade_dias: number;
  preco_de: number;
  preco_por: number;
  desconto_pct: number;
  margem_pct: number | null;
  stock_units: number;
  vendas_dia_unidades: number;
};

export type IdadeMargemBucket = {
  label: string;
  margem_pct: number;
  desconto_pct: number;
  share_estoque_pct: number;
  share_faturamento_pct: number;
  sku_count: number;
  stock_units: number;
};

export type TravaDescontoCell = {
  trava: "alta" | "media" | "baixa";
  desconto: "alto" | "medio" | "baixo";
  health: "green" | "yellow" | "red";
  label: string;
  sku_count: number;
  skus: string[];
};

export type OverviewKpis = {
  total_skus: number;
  skus_com_pricing: number;
  pct_estoque_ate_120d: number;
  margem_media_ponderada_pct: number;
  desconto_medio_ponderado_pct: number;
  skus_em_markdown: number;
  skus_em_markup: number;
};

// Conceito 6 — matriz 3×3 com health colorido.
const TRAVA_DESCONTO_HEALTH: Record<string, { health: "green" | "yellow" | "red"; label: string }> =
  {
    "alta-alto": { health: "green", label: "Comum" },
    "alta-medio": { health: "yellow", label: "Incomum" },
    "alta-baixo": { health: "red", label: "Raro" },
    "media-alto": { health: "yellow", label: "Incomum" },
    "media-medio": { health: "green", label: "Comum" },
    "media-baixo": { health: "yellow", label: "Incomum" },
    "baixa-alto": { health: "red", label: "Nunca" },
    "baixa-medio": { health: "yellow", label: "Incomum" },
    "baixa-baixo": { health: "green", label: "Comum" },
  };

function bucketIdade(idade: number) {
  return IDADE_BUCKETS.find((b) => idade >= b.min && idade <= b.max) ?? IDADE_BUCKETS[0];
}

function bucketTrava(margem_pct: number | null): "alta" | "media" | "baixa" {
  if (margem_pct == null) return "baixa";
  if (margem_pct >= 0.30) return "alta";
  if (margem_pct >= 0.15) return "media";
  return "baixa";
}

function bucketDesconto(desconto_pct: number): "alto" | "medio" | "baixo" {
  if (desconto_pct >= 0.20) return "alto";
  if (desconto_pct >= 0.10) return "medio";
  return "baixo";
}

export async function computeOverview(
  client: SupabaseClient,
  workspaceId: string
): Promise<{
  kpis: OverviewKpis;
  idade_margem: IdadeMargemBucket[];
  trava_desconto: TravaDescontoCell[];
}> {
  // Mais recente snapshot por SKU (evento='baseline' garante 1/dia/SKU)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: snapshots } = await client
    .from("sku_pricing_history")
    .select("sku, idade_dias, preco_de, preco_por, desconto_pct, margem_pct, stock_units, vendas_dia_unidades, snapshot_date, evento")
    .eq("workspace_id", workspaceId)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: false });

  // Reduz pra 1 row por SKU (mais recente)
  const latestBySku = new Map<string, SnapshotRow>();
  for (const row of (snapshots ?? []) as any[]) {
    if (!latestBySku.has(row.sku)) {
      latestBySku.set(row.sku, {
        sku: row.sku,
        idade_dias: Number(row.idade_dias ?? 0),
        preco_de: Number(row.preco_de ?? 0),
        preco_por: Number(row.preco_por ?? 0),
        desconto_pct: Number(row.desconto_pct ?? 0),
        margem_pct: row.margem_pct != null ? Number(row.margem_pct) : null,
        stock_units: Number(row.stock_units ?? 0),
        vendas_dia_unidades: Number(row.vendas_dia_unidades ?? 0),
      });
    }
  }

  const rows = Array.from(latestBySku.values());
  const totalSkus = rows.length;

  const { count: skusComPricing } = await client
    .from("sku_pricing")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  // KPIs
  const totalEstoque = rows.reduce((a, r) => a + r.stock_units, 0);
  const totalEstoqueAte120 = rows
    .filter((r) => r.idade_dias <= 120)
    .reduce((a, r) => a + r.stock_units, 0);
  const totalFaturamentoDia = rows.reduce(
    (a, r) => a + r.vendas_dia_unidades * r.preco_por,
    0
  );

  let somaMargem = 0;
  let pesoMargem = 0;
  let somaDesconto = 0;
  let pesoDesconto = 0;
  for (const r of rows) {
    const fat = r.vendas_dia_unidades * r.preco_por;
    if (r.margem_pct != null) {
      somaMargem += r.margem_pct * fat;
      pesoMargem += fat;
    }
    somaDesconto += r.desconto_pct * fat;
    pesoDesconto += fat;
  }

  const { data: counts } = await client
    .from("sku_pricing_history")
    .select("evento, status")
    .eq("workspace_id", workspaceId)
    .gte("snapshot_date", since);

  let markdowns = 0;
  let markups = 0;
  for (const c of counts ?? []) {
    if (c.evento === "markdown" && (c.status === "applied" || c.status === "approved")) markdowns += 1;
    if (c.evento === "markup" && (c.status === "applied" || c.status === "approved")) markups += 1;
  }

  const kpis: OverviewKpis = {
    total_skus: totalSkus,
    skus_com_pricing: skusComPricing ?? 0,
    pct_estoque_ate_120d:
      totalEstoque > 0 ? (totalEstoqueAte120 / totalEstoque) * 100 : 0,
    margem_media_ponderada_pct: pesoMargem > 0 ? (somaMargem / pesoMargem) * 100 : 0,
    desconto_medio_ponderado_pct:
      pesoDesconto > 0 ? (somaDesconto / pesoDesconto) * 100 : 0,
    skus_em_markdown: markdowns,
    skus_em_markup: markups,
  };

  // Conceito 7 — Matriz Idade × Margem
  const idadeMargem: IdadeMargemBucket[] = IDADE_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.idade_dias >= b.min && r.idade_dias <= b.max);
    const stock = inBucket.reduce((a, r) => a + r.stock_units, 0);
    const fat = inBucket.reduce((a, r) => a + r.vendas_dia_unidades * r.preco_por, 0);
    let sm = 0;
    let pm = 0;
    let sd = 0;
    let pd = 0;
    for (const r of inBucket) {
      const f = r.vendas_dia_unidades * r.preco_por;
      if (r.margem_pct != null) {
        sm += r.margem_pct * f;
        pm += f;
      }
      sd += r.desconto_pct * f;
      pd += f;
    }
    return {
      label: b.label,
      margem_pct: pm > 0 ? (sm / pm) * 100 : 0,
      desconto_pct: pd > 0 ? (sd / pd) * 100 : 0,
      share_estoque_pct: totalEstoque > 0 ? (stock / totalEstoque) * 100 : 0,
      share_faturamento_pct:
        totalFaturamentoDia > 0 ? (fat / totalFaturamentoDia) * 100 : 0,
      sku_count: inBucket.length,
      stock_units: stock,
    };
  });

  // Conceito 6 — Matriz Trava × Desconto 3×3
  const cellMap = new Map<string, { skus: string[] }>();
  for (const r of rows) {
    const trava = bucketTrava(r.margem_pct);
    const desconto = bucketDesconto(r.desconto_pct);
    const key = `${trava}-${desconto}`;
    if (!cellMap.has(key)) cellMap.set(key, { skus: [] });
    cellMap.get(key)!.skus.push(r.sku);
  }
  const trava_desconto: TravaDescontoCell[] = [];
  for (const trava of ["alta", "media", "baixa"] as const) {
    for (const desconto of ["alto", "medio", "baixo"] as const) {
      const key = `${trava}-${desconto}`;
      const cell = cellMap.get(key) ?? { skus: [] };
      const h = TRAVA_DESCONTO_HEALTH[key];
      trava_desconto.push({
        trava,
        desconto,
        health: h.health,
        label: h.label,
        sku_count: cell.skus.length,
        skus: cell.skus.slice(0, 20), // cap pra payload não explodir
      });
    }
  }

  return { kpis, idade_margem: idadeMargem, trava_desconto };
}
