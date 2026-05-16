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
import { evaluateSku, type EngineDecision, type EngineSnapshot } from "./engine";
import { computeMargin } from "./composition";
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
  price: number | null;
  sale_price: number | null;
  created_at: string;
  in_stock: boolean | null;
};

type VendaItem = {
  sku?: string;
  reference?: string;
  quantity?: number;
};

type CrmVendaRow = {
  data_compra: string | null;
  items: VendaItem[] | null;
};

type StockMap = Map<string, number>;

export type OrchestratorOptions = {
  // Quando dryRun=true, não persiste em sku_pricing_history. Usado pelo /preview.
  dryRun?: boolean;
  // Filtra SKUs específicos. Default: todos os ativos do workspace.
  skus?: string[];
  // Fonte do estoque por SKU. Quando omitido, considera stock_units=0 e
  // cobertura=null (engine não toma decisões nesse caso).
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
  let query = client
    .from("shelf_products")
    .select("product_id, sku, name, price, sale_price, created_at, in_stock")
    .eq("workspace_id", workspaceId)
    .eq("active", true);
  if (filterSkus && filterSkus.length > 0) {
    query = query.in("sku", filterSkus);
  }
  const { data, error } = await query;
  if (error) throw new Error(`shelf_products load failed: ${error.message}`);
  return (data ?? []) as ShelfProductRow[];
}

async function loadSkuPricing(client: SupabaseClient, workspaceId: string, skus: string[]) {
  if (skus.length === 0) return new Map<string, any>();
  const { data } = await client
    .from("sku_pricing")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("sku", skus);
  const map = new Map<string, any>();
  for (const row of data ?? []) map.set(row.sku, row);
  return map;
}

async function loadProductCosts(
  client: SupabaseClient,
  workspaceId: string,
  skus: string[]
) {
  if (skus.length === 0) return new Map<string, number>();
  const { data } = await client
    .from("product_costs")
    .select("sku, cost")
    .eq("workspace_id", workspaceId)
    .in("sku", skus);
  const map = new Map<string, number>();
  for (const row of data ?? []) map.set(row.sku, Number(row.cost));
  return map;
}

// Soma de unidades vendidas por SKU nos últimos N dias.
// crm_vendas.items é um JSON array — fazemos agregação em JS porque a
// query SQL ficaria pesada (jsonb_array_elements) e a lista costuma caber
// em memória pro tamanho de workspace típico.
async function loadVendasJanela(
  client: SupabaseClient,
  workspaceId: string,
  janelaDias: number
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - janelaDias * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("crm_vendas")
    .select("data_compra, items")
    .eq("workspace_id", workspaceId)
    .gte("data_compra", since);

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as CrmVendaRow[]) {
    if (!row.items || !Array.isArray(row.items)) continue;
    for (const item of row.items) {
      const sku = (item.sku ?? item.reference ?? "").toString().trim();
      if (!sku) continue;
      const qty = Number(item.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      totals.set(sku, (totals.get(sku) ?? 0) + qty);
    }
  }
  return totals;
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

  const [pricingMap, costsMap, vendasMap, campanhasProdutos] = await Promise.all([
    loadSkuPricing(client, workspaceId, skus),
    loadProductCosts(client, workspaceId, skus),
    loadVendasJanela(client, workspaceId, settings.cobertura_janela_dias),
    loadSkusEmCampanha(client, workspaceId),
  ]);

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

    const pricingRow = pricingMap.get(p.sku);
    const trackedCost = costsMap.get(p.sku);
    const fallbackCogs =
      trackedCost != null
        ? trackedCost
        : precoDe * fin.product_cost_pct;

    const composition: CompositionInput = {
      cogs: fallbackCogs,
      frete_unitario:
        pricingRow?.frete_unitario != null
          ? Number(pricingRow.frete_unitario)
          : fin.custo_frete_medio_brl,
      marketing_unitario: Number(pricingRow?.marketing_unitario ?? 0),
      rateio_fixo: Number(pricingRow?.rateio_fixo ?? 0),
      taxas_comissoes_pct: Number(pricingRow?.taxas_comissoes_pct ?? 0),
      impostos_pct:
        pricingRow?.impostos_pct != null ? Number(pricingRow.impostos_pct) : fin.tax_pct,
      margem_alvo_pct: Number(pricingRow?.margem_alvo_pct ?? 0),
    };

    const desconto_pct_atual = precoDe > 0 ? Math.max(0, 1 - precoPor / precoDe) : 0;
    const margem = computeMargin(composition, precoPor);
    const idade_dias = daysBetween(p.created_at, today);
    const vendas_dia_unidades =
      (vendasMap.get(p.sku) ?? 0) / Math.max(1, settings.cobertura_janela_dias);
    const stock_units = opts.stock?.get(p.sku) ?? 0;
    const cobertura_dias =
      vendas_dia_unidades > 0 && stock_units > 0
        ? Math.round(stock_units / vendas_dia_unidades)
        : null;

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
      em_campanha: campanhasProdutos.has(p.product_id),
      composition,
    };

    const decision = evaluateSku(snapshot, settings);
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
