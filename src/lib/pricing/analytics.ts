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

type ShelfRow = {
  sku: string | null;
  price: number | null;
  sale_price: number | null;
  created_at: string | null;
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
  skus_com_composicao: number;
  skus_com_cmv: number;
  cost_coverage_pct: number;
  snapshot_sku_count: number;
  pct_estoque_ate_120d: number;
  margem_media_ponderada_pct: number;
  desconto_medio_ponderado_pct: number;
  skus_em_markdown: number;
  skus_em_markup: number;
};

export type PricingDataQuality = {
  engine_enabled: boolean | null;
  catalog_sku_count: number;
  snapshot_sku_count: number;
  latest_snapshot_date: string | null;
  snapshot_age_days: number | null;
  snapshot_stale: boolean;
  cmv_tracked_skus: number;
  cmv_coverage_pct: number;
  manual_composition_skus: number;
  warnings: string[];
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
  data_quality: PricingDataQuality;
}> {
  const [shelf, snapshots, costsBySku, manualCompositionCount, engineEnabled] = await Promise.all([
    loadActiveShelfRows(client, workspaceId),
    loadPricingSnapshots(client, workspaceId),
    loadProductCostSkus(client, workspaceId),
    countManualCompositions(client, workspaceId),
    loadEngineEnabled(client, workspaceId),
  ]);

  // Reduz pra 1 row por SKU (mais recente)
  const latestBySku = new Map<string, SnapshotRow>();
  let latestSnapshotDate: string | null = null;
  for (const row of snapshots) {
    const snapshotDate = String(row.snapshot_date ?? "");
    if (snapshotDate && (!latestSnapshotDate || snapshotDate > latestSnapshotDate)) {
      latestSnapshotDate = snapshotDate;
    }
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

  const rows: SnapshotRow[] = [];
  const activeSkus = new Set<string>();
  for (const product of shelf) {
    const sku = product.sku?.trim();
    if (!sku) continue;
    if (activeSkus.has(sku)) continue;
    activeSkus.add(sku);
    const snap = latestBySku.get(sku);
    if (snap) {
      rows.push(snap);
      continue;
    }
    const precoDe = Number(product.price ?? 0);
    const precoPor = product.sale_price != null ? Number(product.sale_price) : precoDe;
    rows.push({
      sku,
      idade_dias: ageDays(product.created_at),
      preco_de: precoDe,
      preco_por: precoPor,
      desconto_pct: precoDe > 0 ? Math.max(0, 1 - precoPor / precoDe) : 0,
      margem_pct: null,
      stock_units: 0,
      vendas_dia_unidades: 0,
    });
  }

  const totalSkus = activeSkus.size;
  const skusComCmv = [...activeSkus].filter((sku) => costsBySku.has(sku)).length;
  const costCoveragePct = totalSkus > 0 ? (skusComCmv / totalSkus) * 100 : 0;
  const snapshotSkuCount = [...activeSkus].filter((sku) => latestBySku.has(sku)).length;
  const snapshotAgeDays = latestSnapshotDate
    ? Math.floor(
        (Date.now() - new Date(`${latestSnapshotDate}T00:00:00.000Z`).getTime()) /
          (24 * 60 * 60 * 1000)
      )
    : null;
  const snapshotStale = snapshotAgeDays == null || snapshotAgeDays > 2;

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
    .eq("workspace_id", workspaceId);

  let markdowns = 0;
  let markups = 0;
  for (const c of counts ?? []) {
    if (c.evento === "markdown" && (c.status === "applied" || c.status === "approved")) markdowns += 1;
    if (c.evento === "markup" && (c.status === "applied" || c.status === "approved")) markups += 1;
  }

  const kpis: OverviewKpis = {
    total_skus: totalSkus,
    // Campo legado: a UI antiga lia "skus_com_pricing". Na prática,
    // CMV cadastrado é o requisito que desbloqueia margem confiável.
    skus_com_pricing: skusComCmv,
    skus_com_composicao: manualCompositionCount,
    skus_com_cmv: skusComCmv,
    cost_coverage_pct: costCoveragePct,
    snapshot_sku_count: snapshotSkuCount,
    pct_estoque_ate_120d:
      totalEstoque > 0 ? (totalEstoqueAte120 / totalEstoque) * 100 : 0,
    margem_media_ponderada_pct: pesoMargem > 0 ? (somaMargem / pesoMargem) * 100 : 0,
    desconto_medio_ponderado_pct:
      pesoDesconto > 0 ? (somaDesconto / pesoDesconto) * 100 : 0,
    skus_em_markdown: markdowns,
    skus_em_markup: markups,
  };

  const warnings: string[] = [];
  if (engineEnabled === false) {
    warnings.push("Engine de pricing está desativado; o worker diário não gera novos snapshots.");
  }
  if (snapshotStale) {
    warnings.push(
      latestSnapshotDate
        ? `Engine sem snapshot novo há ${snapshotAgeDays} dias (último: ${latestSnapshotDate}).`
        : "Engine ainda não gerou snapshot de pricing."
    );
  }
  if (snapshotSkuCount < totalSkus) {
    warnings.push(
      `Snapshot cobre ${snapshotSkuCount} de ${totalSkus} SKUs ativos; SKUs sem snapshot entram sem estoque/venda.`
    );
  }
  if (costCoveragePct < 80) {
    warnings.push(
      `CMV rastreado cobre ${costCoveragePct.toFixed(0)}% dos SKUs ativos; margens restantes usam premissa/categoria.`
    );
  }

  const dataQuality: PricingDataQuality = {
    engine_enabled: engineEnabled,
    catalog_sku_count: totalSkus,
    snapshot_sku_count: snapshotSkuCount,
    latest_snapshot_date: latestSnapshotDate,
    snapshot_age_days: snapshotAgeDays,
    snapshot_stale: snapshotStale,
    cmv_tracked_skus: skusComCmv,
    cmv_coverage_pct: costCoveragePct,
    manual_composition_skus: manualCompositionCount,
    warnings,
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

  return { kpis, idade_margem: idadeMargem, trava_desconto, data_quality: dataQuality };
}

async function loadEngineEnabled(client: SupabaseClient, workspaceId: string) {
  const { data, error } = await client
    .from("pricing_engine_settings")
    .select("enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`pricing_engine_settings load failed: ${error.message}`);
  return data ? Boolean((data as { enabled?: boolean | null }).enabled) : null;
}

async function loadActiveShelfRows(
  client: SupabaseClient,
  workspaceId: string
): Promise<ShelfRow[]> {
  const rows: ShelfRow[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("shelf_products")
      .select("sku, price, sale_price, created_at")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`shelf_products load failed: ${error.message}`);
    const page = (data ?? []) as ShelfRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadPricingSnapshots(
  client: SupabaseClient,
  workspaceId: string
): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("sku_pricing_history")
      .select(
        "sku, idade_dias, preco_de, preco_por, desconto_pct, margem_pct, stock_units, vendas_dia_unidades, snapshot_date, evento"
      )
      .eq("workspace_id", workspaceId)
      .order("snapshot_date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`sku_pricing_history load failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadProductCostSkus(
  client: SupabaseClient,
  workspaceId: string
): Promise<Set<string>> {
  const skus = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("product_costs")
      .select("sku")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`product_costs load failed: ${error.message}`);
    const page = (data ?? []) as Array<{ sku: string | null }>;
    for (const row of page) {
      const sku = row.sku?.trim();
      if (sku) skus.add(sku);
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return skus;
}

async function countManualCompositions(client: SupabaseClient, workspaceId: string) {
  const { count, error } = await client
    .from("sku_pricing")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`sku_pricing count failed: ${error.message}`);
  return count ?? 0;
}

function ageDays(value: string | null | undefined): number {
  if (!value) return 0;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
}
