// Orchestrator do engine de pricing.
//
// Fluxo:
//   1. Carrega settings + lista de SKUs (shelf_products active=true)
//   2. Carrega sku_pricing + product_costs + workspace_financial_settings
//   3. Carrega crm_vendas dos últimos N dias (cobertura_janela_dias)
//   4. Carrega cupons/campanhas ativas (promo_active_coupons) para sinalizar
//      em_campanha quando override_dynamic=true no plano
//   5. Para cada SKU: monta EngineSnapshot, chama evaluateSku(), persiste
//      em sku_pricing_history (status=pending se require_approval, senão approved)
//
// Chamado pelo cron diário e pelas rotas /api/pricing/engine/preview e /run.

import type { SupabaseClient } from "@supabase/supabase-js";
import { eccosys } from "@/lib/eccosys/client";
import { normalizeEccosysStockQuantity } from "@/lib/eccosys/stock";
import type { EccosysEstoque } from "@/types/hub";
import { evaluateSku, type EngineDecision, type EngineSnapshot } from "./engine";
import { computeMargin } from "./composition";
import { buildCategoryAvgMap, type CategoryAvgMap } from "./category-cost";
import { baseSkuOf } from "./sku-utils";
import {
  fetchRecentCrmSalesWithItems,
  parsePricingCrmDate,
  saleItemBaseSku,
  saleItemQuantity,
} from "./crm-sales";
import {
  DEFAULT_ENGINE_SETTINGS,
  type CompositionInput,
  type EngineSettings,
} from "./types";

const FINANCIAL_DEFAULTS = {
  product_cost_pct: 25,
  tax_pct: 6,
  other_expenses_pct: 5,
  custo_frete_medio_brl: 18,
};

type ShelfProductRow = {
  product_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number | null;
  sale_price: number | null;
  created_at: string;
  in_stock: boolean | null;
  // shelf_products.tags é JSONB array: pode ter strings ou objetos { name, ... }
  tags: unknown;
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Extrai os nomes de tag de shelf_products.tags. A coluna tem mix de:
//   - strings: "combos", "regatas"
//   - objetos: { name: "combos", tag_type: "promo", ... }
function extractTagNames(tags: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(tags)) return out;
  for (const t of tags) {
    if (typeof t === "string") out.add(t.toLowerCase());
    else if (t && typeof t === "object") {
      const name = (t as { name?: unknown }).name;
      if (typeof name === "string") out.add(name.toLowerCase());
    }
  }
  return out;
}

type StockMap = Map<string, number>;

export type OrchestratorOptions = {
  // Quando dryRun=true, não persiste em sku_pricing_history. Usado pelo /preview.
  dryRun?: boolean;
  // Filtra SKUs específicos. Default: todos os ativos do workspace.
  skus?: string[];
  // Override de estoque (Map<sku, units>). Quando omitido, o orchestrator
  // tenta carregar do Eccosys em uma leitura via listStockBulk(). Se
  // o workspace não tem Eccosys configurado, assume 0 (engine vai retornar
  // 'hold' por falta de cobertura).
  stock?: StockMap;
  // Override de data do snapshot (default: hoje). Útil pra reprocessamento.
  snapshotDate?: string;
};

export type OrchestratorResult = {
  workspace_id: string;
  snapshot_date: string;
  evaluated: number;
  decisions: EngineDecision[];
  skipped_no_price: number;
  skipped_no_pricing_row: number;
  stock_source: "eccosys" | "param" | "none";
  stock_sku_count: number;
};

export async function loadEngineSettings(
  client: SupabaseClient,
  workspaceId: string
): Promise<EngineSettings> {
  const { data } = await client
    .from("pricing_engine_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) {
    return { workspace_id: workspaceId, ...DEFAULT_ENGINE_SETTINGS };
  }
  return data as EngineSettings;
}

async function loadFinancialFallbacks(client: SupabaseClient, workspaceId: string) {
  const { data } = await client
    .from("workspace_financial_settings")
    .select("product_cost_pct, tax_pct, other_expenses_pct, custo_frete_medio_brl")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return {
    product_cost_pct:
      Number((data as any)?.product_cost_pct ?? FINANCIAL_DEFAULTS.product_cost_pct) / 100,
    tax_pct: Number((data as any)?.tax_pct ?? FINANCIAL_DEFAULTS.tax_pct) / 100,
    other_expenses_pct:
      Number((data as any)?.other_expenses_pct ?? FINANCIAL_DEFAULTS.other_expenses_pct) /
      100,
    custo_frete_medio_brl: Number(
      (data as any)?.custo_frete_medio_brl ?? FINANCIAL_DEFAULTS.custo_frete_medio_brl
    ),
  };
}

async function loadShelfProducts(
  client: SupabaseClient,
  workspaceId: string,
  filterSkus?: string[]
): Promise<ShelfProductRow[]> {
  const rows: ShelfProductRow[] = [];
  const pageSize = 1000;

  if (filterSkus && filterSkus.length > 0) {
    for (const chunk of chunks(filterSkus, 500)) {
      const { data, error } = await client
        .from("shelf_products")
        .select("product_id, sku, name, category, price, sale_price, created_at, in_stock, tags")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .in("sku", chunk);
      if (error) throw new Error(`shelf_products load failed: ${error.message}`);
      rows.push(...((data ?? []) as ShelfProductRow[]));
    }
    return rows;
  }

  let from = 0;
  while (true) {
    const { data, error } = await client
      .from("shelf_products")
      .select("product_id, sku, name, category, price, sale_price, created_at, in_stock, tags")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`shelf_products load failed: ${error.message}`);
    const page = (data ?? []) as ShelfProductRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function loadSkuPricing(client: SupabaseClient, workspaceId: string, skus: string[]) {
  if (skus.length === 0) return new Map<string, any>();
  const map = new Map<string, any>();
  for (const chunk of chunks(skus, 500)) {
    const { data } = await client
      .from("sku_pricing")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("sku", chunk);
    for (const row of data ?? []) map.set(row.sku, row);
  }
  return map;
}

async function loadProductCosts(
  client: SupabaseClient,
  workspaceId: string,
  skus: string[]
) {
  if (skus.length === 0) return new Map<string, number>();
  const map = new Map<string, number>();
  for (const chunk of chunks(skus, 500)) {
    const { data } = await client
      .from("product_costs")
      .select("sku, cost")
      .eq("workspace_id", workspaceId)
      .in("sku", chunk);
    for (const row of data ?? []) map.set(row.sku, Number(row.cost));
  }
  return map;
}

// Soma de unidades vendidas por SKU base nos últimos N dias.
// crm_vendas.items[].sku vem com sufixo de tamanho (-N); agregamos pelo
// SKU pai (referência) que é o que o shelf_products usa.
async function loadVendasJanela(
  client: SupabaseClient,
  workspaceId: string,
  janelaDias: number
): Promise<Map<string, number>> {
  const sales = await fetchRecentCrmSalesWithItems(client, workspaceId, janelaDias);

  const totals = new Map<string, number>();
  for (const row of sales) {
    if (!row.items || !Array.isArray(row.items)) continue;
    for (const item of row.items) {
      const sku = saleItemBaseSku(item);
      const qty = saleItemQuantity(item);
      if (!sku || qty <= 0) continue;
      totals.set(sku, (totals.get(sku) ?? 0) + qty);
    }
  }
  return totals;
}

// Data de lançamento por SKU (sku_launch_dates) — fonte primária de idade
// quando disponível. Importado de relatório de coleções periodicamente.
async function loadLaunchDates(
  client: SupabaseClient,
  workspaceId: string
): Promise<Map<string, Date>> {
  const { data } = await client
    .from("sku_launch_dates")
    .select("sku, launch_date")
    .eq("workspace_id", workspaceId);
  const map = new Map<string, Date>();
  for (const row of data ?? []) {
    const r = row as { sku: string; launch_date: string };
    if (r.sku && r.launch_date) map.set(r.sku, new Date(r.launch_date));
  }
  return map;
}

// Data de criação no Hub ML / pre-cadastro — captura idade pra novos
// produtos que ainda não entraram no relatório de coleções. Usado quando
// sku_launch_dates não tem o SKU.
//
// Cascata interna por SKU base (já que hub_products usa SKU com sufixo de
// tamanho e product_collections.created_at é por coleção inteira):
//   1. MIN(hub_products.created_at) entre variações do SKU base
//   2. MIN(product_collections.created_at) via collection_items.codigo
async function loadHubAndCollectionDates(
  client: SupabaseClient,
  workspaceId: string
): Promise<Map<string, Date>> {
  const [hubRes, collRes] = await Promise.all([
    client
      .from("hub_products")
      .select("sku, created_at")
      .eq("workspace_id", workspaceId),
    // collection_items.codigo é o SKU; product_collections.created_at é a
    // data da coleção no pre-cadastro. JOIN via FK.
    client
      .from("collection_items")
      .select("codigo, product_collections(created_at)")
      .eq("workspace_id", workspaceId),
  ]);

  const map = new Map<string, Date>();
  const setMin = (key: string, d: Date) => {
    const cur = map.get(key);
    if (!cur || d < cur) map.set(key, d);
  };

  for (const row of hubRes.data ?? []) {
    const r = row as { sku: string | null; created_at: string };
    if (!r.sku || !r.created_at) continue;
    setMin(baseSkuOf(r.sku), new Date(r.created_at));
  }

  for (const row of collRes.data ?? []) {
    const r = row as unknown as {
      codigo: string | null;
      product_collections: { created_at: string } | { created_at: string }[] | null;
    };
    if (!r.codigo) continue;
    // Supabase pode retornar a relation como array (1..N) ou objeto único.
    const rel = Array.isArray(r.product_collections)
      ? r.product_collections[0]
      : r.product_collections;
    const created = rel?.created_at;
    if (!created) continue;
    setMin(baseSkuOf(r.codigo), new Date(created));
  }

  return map;
}

// Primeira data de venda por SKU base, usada como proxy de idade em catálogo
// (shelf_products.created_at é resetado a cada sync, não confiável). Olhamos
// uma janela ampla — vendas dos últimos 12 meses — pra capturar a primeira
// aparição do produto.
async function loadFirstSaleBySku(
  client: SupabaseClient,
  workspaceId: string
): Promise<Map<string, Date>> {
  const sales = await fetchRecentCrmSalesWithItems(client, workspaceId, 365);

  const firstByBase = new Map<string, Date>();
  for (const row of sales) {
    if (!row.data_compra || !Array.isArray(row.items)) continue;
    const d = parsePricingCrmDate(row.data_compra);
    if (!d) continue;
    for (const item of row.items) {
      const sku = saleItemBaseSku(item);
      if (!sku) continue;
      const current = firstByBase.get(sku);
      if (!current || d < current) firstByBase.set(sku, d);
    }
  }
  return firstByBase;
}

// Carrega estoque por SKU base do Eccosys em massa via /estoques.
// Eccosys retorna 1 row por variação de tamanho (codigo "256391234-1", -2, -3,
// -4); somamos todas as variações pra obter o estoque total da referência pai
// (que é como shelf_products.sku está organizado).
async function loadStockFromEccosys(
  workspaceId: string
): Promise<{ map: Map<string, number>; source: "eccosys" | "none" }> {
  const map = new Map<string, number>();
  try {
    const all = await eccosys.listStockBulk<EccosysEstoque>(workspaceId);
    for (const es of all) {
      if (!es.codigo) continue;
      // Eccosys pode retornar negativo quando estoque comprometido > físico.
      // Clamp em 0 — pricing trata isso como sem estoque.
      const stock = Math.max(0, normalizeEccosysStockQuantity(es.estoqueDisponivel));
      const base = baseSkuOf(String(es.codigo));
      map.set(base, (map.get(base) ?? 0) + stock);
    }
    return { map, source: "eccosys" };
  } catch (err) {
    console.warn(
      `[pricing/orchestrator] eccosys stock fetch failed for ${workspaceId}:`,
      (err as Error).message
    );
    return { map, source: "none" };
  }
}

// SKUs com cupom ativo via promo_active_coupons. Considera apenas planos
// com override_dynamic=true.
async function loadSkusEmCampanha(
  client: SupabaseClient,
  workspaceId: string
): Promise<Set<string>> {
  const now = new Date().toISOString();
  const { data } = await client
    .from("promo_active_coupons")
    .select("product_id, status, expires_at, plan_id")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "pending"])
    .gte("expires_at", now);

  const plansActive = new Set<string>();
  const ids = (data ?? []).map((r: any) => r.plan_id).filter((id: any) => !!id);
  if (ids.length > 0) {
    const { data: plans } = await client
      .from("promo_coupon_plans")
      .select("id, override_dynamic")
      .in("id", ids);
    for (const p of plans ?? []) {
      if ((p as any).override_dynamic) plansActive.add((p as any).id);
    }
  }

  const productIds = new Set<string>();
  for (const row of data ?? []) {
    const r = row as any;
    if (!r.plan_id || plansActive.has(r.plan_id)) {
      productIds.add(String(r.product_id));
    }
  }
  return productIds;
}

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export async function runOrchestrator(
  client: SupabaseClient,
  workspaceId: string,
  opts: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const settings = await loadEngineSettings(client, workspaceId);
  const fin = await loadFinancialFallbacks(client, workspaceId);
  const shelf = await loadShelfProducts(client, workspaceId, opts.skus);
  const skus = shelf.map((p) => p.sku).filter((s): s is string => !!s);

  const stockProvided = opts.stock != null;
  const [
    pricingMap,
    costsMap,
    vendasMap,
    firstSaleMap,
    launchMap,
    hubMap,
    campanhasProdutos,
    stockResult,
    categoryAvg,
  ] = await Promise.all([
    loadSkuPricing(client, workspaceId, skus),
    loadProductCosts(client, workspaceId, skus),
    loadVendasJanela(client, workspaceId, settings.cobertura_janela_dias),
    loadFirstSaleBySku(client, workspaceId),
    loadLaunchDates(client, workspaceId),
    loadHubAndCollectionDates(client, workspaceId),
    loadSkusEmCampanha(client, workspaceId),
    stockProvided
      ? Promise.resolve({ map: opts.stock as StockMap, source: "param" as const })
      : loadStockFromEccosys(workspaceId),
    buildCategoryAvgMap(client, workspaceId),
  ]);
  const stockMap = stockResult.map;
  const stockSource = stockResult.source;

  const today = new Date();
  const snapshotDate =
    opts.snapshotDate ?? today.toISOString().slice(0, 10);

  const decisions: EngineDecision[] = [];
  let skipped_no_price = 0;
  let skipped_no_pricing_row = 0;

  for (const p of shelf) {
    if (!p.sku) {
      skipped_no_pricing_row += 1;
      continue;
    }
    const precoDe = Number(p.price ?? 0);
    const precoPor = p.sale_price != null ? Number(p.sale_price) : precoDe;
    if (precoDe <= 0) {
      skipped_no_price += 1;
      continue;
    }

    // Detecta tags do produto. Usado pra:
    //   1. Excluir 100% do engine (settings.engine_excluded_tags — override
    //      manual, default vazio).
    //   2. Marcar em_combo (settings.combo_tag — pra trava considerar combo).
    const tagNames = extractTagNames(p.tags);
    const excludedHit = settings.engine_excluded_tags.find((t) =>
      tagNames.has(t.toLowerCase())
    );

    const pricingRow = pricingMap.get(p.sku);
    const trackedCost = costsMap.get(p.sku);
    // Cascata de CMV:
    //   1. product_costs.cost (cadastrado por SKU)
    //   2. média de produto_costs da mesma categoria (regra do user)
    //   3. % global do preço (last resort)
    const catAvg =
      p.category != null ? categoryAvg.get(p.category.toUpperCase()) : undefined;
    const fallbackCogs =
      trackedCost != null
        ? trackedCost
        : catAvg != null
          ? catAvg
          : precoDe * fin.product_cost_pct;

    const composition: CompositionInput = {
      cogs: fallbackCogs,
      frete_unitario:
        pricingRow?.frete_unitario != null
          ? Number(pricingRow.frete_unitario)
          : fin.custo_frete_medio_brl,
      marketing_unitario: Number(pricingRow?.marketing_unitario ?? 0),
      rateio_fixo: Number(pricingRow?.rateio_fixo ?? 0),
      taxas_comissoes_pct:
        pricingRow?.taxas_comissoes_pct != null
          ? Number(pricingRow.taxas_comissoes_pct)
          : fin.other_expenses_pct,
      impostos_pct:
        pricingRow?.impostos_pct != null ? Number(pricingRow.impostos_pct) : fin.tax_pct,
      margem_alvo_pct: Number(pricingRow?.margem_alvo_pct ?? 0),
    };

    const desconto_pct_atual = precoDe > 0 ? Math.max(0, 1 - precoPor / precoDe) : 0;
    const margem = computeMargin(composition, precoPor);
    // Idade — cascata:
    //   1. sku_launch_dates.launch_date (relatório de coleções — fonte mais
    //      confiável quando existe)
    //   2. hub_products.created_at / product_collections.created_at (captura
    //      automaticamente data de produtos novos cadastrados via Hub ML ou
    //      pre-cadastro)
    //   3. Primeira venda em crm_vendas (últimos 365d)
    //   4. shelf_products.created_at (fallback final)
    const launch = launchMap.get(p.sku);
    const hubDate = hubMap.get(p.sku);
    const firstSale = firstSaleMap.get(p.sku);
    const idadeReferencia = launch ?? hubDate ?? firstSale;
    const idade_dias = idadeReferencia
      ? Math.max(0, Math.floor((today.getTime() - idadeReferencia.getTime()) / (1000 * 60 * 60 * 24)))
      : daysBetween(p.created_at, today);
    const vendas_dia_unidades =
      (vendasMap.get(p.sku) ?? 0) / Math.max(1, settings.cobertura_janela_dias);
    const stock_units = stockMap.get(p.sku) ?? 0;
    const cobertura_dias =
      vendas_dia_unidades > 0 && stock_units > 0
        ? Math.round(stock_units / vendas_dia_unidades)
        : null;

    const em_combo =
      settings.combo_tag.length > 0 &&
      tagNames.has(settings.combo_tag.toLowerCase());

    const snapshot: EngineSnapshot = {
      sku: p.sku,
      preco_de: precoDe,
      preco_por: precoPor,
      desconto_pct_atual,
      idade_dias,
      cobertura_dias,
      stock_units,
      vendas_dia_unidades,
      margem_pct_atual: precoPor > 0 ? margem.margem_pct : null,
      em_combo,
      em_campanha: campanhasProdutos.has(p.product_id),
      composition,
    };

    // Override manual: SKU com tag em engine_excluded_tags → engine não toca
    const decision = excludedHit
      ? {
          ...evaluateSku(snapshot, settings),
          action: "hold" as const,
          reason: `excluído por tag "${excludedHit}" (override manual em settings)`,
          preco_por_novo: snapshot.preco_por,
          desconto_pct_novo: snapshot.desconto_pct_atual,
          margem_pct_nova: snapshot.margem_pct_atual,
          margem_brl_nova: null,
        }
      : evaluateSku(snapshot, settings);
    decisions.push(decision);

    if (!opts.dryRun) {
      await persistDecision(client, workspaceId, snapshotDate, snapshot, decision, settings);
    }
  }

  return {
    workspace_id: workspaceId,
    snapshot_date: snapshotDate,
    evaluated: decisions.length,
    decisions,
    skipped_no_price,
    skipped_no_pricing_row,
    stock_source: stockSource,
    stock_sku_count: stockMap.size,
  };
}

async function persistDecision(
  client: SupabaseClient,
  workspaceId: string,
  snapshotDate: string,
  snapshot: EngineSnapshot,
  decision: EngineDecision,
  settings: EngineSettings
): Promise<void> {
  // Mantém baseline pra todo SKU (até quando action='hold') pra alimentar a
  // matriz idade × margem na Fase 3.
  const evento: string =
    decision.action === "hold" ? "baseline" : decision.action;
  const status =
    decision.action === "hold"
      ? "skipped"
      : settings.require_approval
        ? "pending"
        : "approved";

  const row = {
    workspace_id: workspaceId,
    sku: snapshot.sku,
    snapshot_date: snapshotDate,
    idade_dias: snapshot.idade_dias,
    cobertura_dias: snapshot.cobertura_dias,
    stock_units: snapshot.stock_units,
    vendas_dia_unidades: snapshot.vendas_dia_unidades,
    preco_de: snapshot.preco_de,
    // preco_por_anterior = preço efetivamente praticado ANTES da decisão
    // (sale_price atual ou preço cheio se nunca esteve em sale). Sem isso,
    // a UI mostraria "De [cheio] → [novo]" quando o produto já estava
    // descontado, distorcendo o delta percebido.
    preco_por_anterior: snapshot.preco_por,
    preco_por: decision.action === "hold" ? snapshot.preco_por : decision.preco_por_novo,
    desconto_pct:
      decision.action === "hold" ? snapshot.desconto_pct_atual : decision.desconto_pct_novo,
    margem_brl:
      decision.action === "hold"
        ? null
        : decision.margem_brl_nova,
    margem_pct:
      decision.action === "hold"
        ? snapshot.margem_pct_atual
        : decision.margem_pct_nova,
    evento,
    pilar_ativo: snapshot.em_campanha ? "campanha" : "dinamico",
    rule_applied: decision.rule as unknown as Record<string, unknown>,
    status,
    status_reason: decision.reason,
  };

  const { error } = await client.from("sku_pricing_history").upsert(row, {
    onConflict: "workspace_id,sku,snapshot_date,evento",
  });
  if (error) {
    console.warn(
      `[pricing/orchestrator] persist failed for sku ${snapshot.sku}: ${error.message}`
    );
  }
}
