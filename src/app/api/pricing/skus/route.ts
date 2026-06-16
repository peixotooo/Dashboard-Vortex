// GET /api/pricing/skus — lista paginada de SKUs do workspace com flag de
// pricing cadastrado (LEFT JOIN com sku_pricing) e último snapshot.
//
// Usado pela tela landing /pricing pra mostrar quantos SKUs já têm composição
// cadastrada vs pendentes. Query simples — paginação por offset.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";

type ShelfProductRow = {
  product_id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  in_stock: boolean | null;
  created_at: string | null;
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const status = searchParams.get("status"); // 'all' | 'configured' | 'pending'
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "30", 10) || 30));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

    const allShelf = await loadActiveShelfProducts(auth.supabase, auth.workspaceId);
    const qLower = q.toLowerCase();
    const shelfMatchingQuery = qLower
      ? allShelf.filter((p) =>
          [p.name, p.sku, p.product_id]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(qLower))
        )
      : allShelf;

    const skus = shelfMatchingQuery.map((p) => p.sku).filter((s): s is string => !!s);
    if (skus.length === 0) {
      return NextResponse.json({
        items: [],
        count: 0,
        summary: {
          total_matching: 0,
          configured_matching: 0,
          manual_composition_matching: 0,
          cogs_tracked_matching: 0,
        },
      });
    }

    const [pricingRows, costRows] = await Promise.all([
      loadPricingRows(auth.supabase, auth.workspaceId, skus),
      loadCostRows(auth.supabase, auth.workspaceId, skus),
    ]);

    const pricingMap = new Map<string, (typeof pricingRows)[number]>();
    for (const row of pricingRows) pricingMap.set(row.sku, row);
    const costsMap = new Map<string, number>();
    for (const row of costRows) costsMap.set(row.sku, Number(row.cost));

    const allItems = shelfMatchingQuery.map((p) => {
      const skuKey = p.sku || p.product_id;
      const pricing = p.sku ? pricingMap.get(p.sku) : undefined;
      const cogs = p.sku ? costsMap.get(p.sku) : undefined;
      const precoDe = Number(p.price ?? 0);
      const precoPor = p.sale_price != null ? Number(p.sale_price) : precoDe;
      const hasManualComposition = pricing != null;
      const cogsTracked = cogs != null;
      const pricingReady = hasManualComposition || cogsTracked;
      return {
        sku: skuKey,
        product_id: p.product_id,
        name: p.name,
        category: p.category,
        preco_de: precoDe,
        preco_por: precoPor,
        desconto_pct: precoDe > 0 ? Math.max(0, 1 - precoPor / precoDe) : 0,
        image_url: p.image_url,
        in_stock: p.in_stock !== false,
        created_at: p.created_at,
        has_pricing: pricingReady,
        has_manual_composition: hasManualComposition,
        cogs_tracked: cogsTracked,
        cogs,
        preco_minimo_calc: pricing?.preco_minimo_calc != null ? Number(pricing.preco_minimo_calc) : null,
        preco_alvo_calc: pricing?.preco_alvo_calc != null ? Number(pricing.preco_alvo_calc) : null,
        margem_alvo_pct: pricing?.margem_alvo_pct != null ? Number(pricing.margem_alvo_pct) : null,
      };
    });

    const filtered = status === "configured"
      ? allItems.filter((i) => i.has_pricing)
      : status === "pending"
        ? allItems.filter((i) => !i.has_pricing)
        : allItems;

    const items = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      items,
      count: filtered.length,
      summary: {
        total_matching: allItems.length,
        configured_matching: allItems.filter((i) => i.has_pricing).length,
        manual_composition_matching: allItems.filter((i) => i.has_manual_composition).length,
        cogs_tracked_matching: allItems.filter((i) => i.cogs_tracked).length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadActiveShelfProducts(
  supabase: any,
  workspaceId: string
): Promise<ShelfProductRow[]> {
  const rows: ShelfProductRow[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("shelf_products")
      .select("product_id, sku, name, category, price, sale_price, image_url, in_stock, created_at")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ShelfProductRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadPricingRows(supabase: any, workspaceId: string, skus: string[]) {
  const rows: Array<{
    sku: string;
    margem_alvo_pct: number | null;
    preco_minimo_calc: number | null;
    preco_alvo_calc: number | null;
    updated_at: string | null;
  }> = [];
  for (const chunk of chunks(skus, 500)) {
    const { data, error } = await supabase
      .from("sku_pricing")
      .select("sku, margem_alvo_pct, preco_minimo_calc, preco_alvo_calc, updated_at")
      .eq("workspace_id", workspaceId)
      .in("sku", chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadCostRows(supabase: any, workspaceId: string, skus: string[]) {
  const rows: Array<{ sku: string; cost: number | null }> = [];
  for (const chunk of chunks(skus, 500)) {
    const { data, error } = await supabase
      .from("product_costs")
      .select("sku, cost")
      .eq("workspace_id", workspaceId)
      .in("sku", chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
