// Fallback de CMV por média da categoria (regra do user):
//
// Quando product_costs não tem um SKU, calcular a média de cost dos SKUs
// da mesma categoria. Categoria vem de shelf_products.category.
//
// Runtime, sem persistência — quando um SKU ganha custo real, as médias
// se atualizam sozinhas no próximo cálculo.
//
// O orchestrator pré-computa um Map<category, avg> antes do loop pra
// evitar query repetida. Rotas one-off (GET sku) podem usar getCategoryAvgCogs()
// pra um único valor.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoryAvgMap = Map<string, number>;

// Pré-computa média de CMV por categoria pro workspace inteiro. Faz JOIN
// implícito product_costs + shelf_products via duas queries + agregação JS.
//
// Postgres não permite JOIN direto via Supabase REST sem foreign key, então
// vamos com duas queries simples (rápido — table pequena por workspace).
export async function buildCategoryAvgMap(
  client: SupabaseClient,
  workspaceId: string
): Promise<CategoryAvgMap> {
  const [costsRes, shelfRes] = await Promise.all([
    client
      .from("product_costs")
      .select("sku, cost")
      .eq("workspace_id", workspaceId),
    client
      .from("shelf_products")
      .select("sku, category")
      .eq("workspace_id", workspaceId),
  ]);

  const categoryBySku = new Map<string, string>();
  for (const row of shelfRes.data ?? []) {
    const r = row as { sku: string | null; category: string | null };
    if (r.sku && r.category) categoryBySku.set(r.sku, r.category.toUpperCase());
  }

  const sumByCategory = new Map<string, { sum: number; count: number }>();
  for (const row of costsRes.data ?? []) {
    const r = row as { sku: string; cost: number };
    const cat = categoryBySku.get(r.sku);
    if (!cat) continue;
    const cur = sumByCategory.get(cat) ?? { sum: 0, count: 0 };
    cur.sum += Number(r.cost);
    cur.count += 1;
    sumByCategory.set(cat, cur);
  }

  const avgMap: CategoryAvgMap = new Map();
  for (const [cat, { sum, count }] of sumByCategory) {
    if (count > 0) avgMap.set(cat, sum / count);
  }
  return avgMap;
}

// Lookup de uma categoria específica (usado pela rota GET /api/pricing/sku/[sku]).
// Faz uma query mais leve — apenas SKUs daquela categoria.
export async function getCategoryAvgCogs(
  client: SupabaseClient,
  workspaceId: string,
  category: string | null
): Promise<number | null> {
  if (!category) return null;
  const cat = category.toUpperCase();

  const { data: shelf } = await client
    .from("shelf_products")
    .select("sku")
    .eq("workspace_id", workspaceId)
    .ilike("category", cat);

  const skus = (shelf ?? [])
    .map((r) => (r as { sku: string | null }).sku)
    .filter((s): s is string => !!s);
  if (skus.length === 0) return null;

  const { data: costs } = await client
    .from("product_costs")
    .select("cost")
    .eq("workspace_id", workspaceId)
    .in("sku", skus);

  if (!costs || costs.length === 0) return null;
  const sum = costs.reduce((a, r) => a + Number((r as { cost: number }).cost), 0);
  return sum / costs.length;
}
