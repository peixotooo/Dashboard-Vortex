// GET/PUT da composição de preço por SKU.
//
// GET: devolve composição persistida em sku_pricing + dados do produto
// (shelf_products) + product_costs.cost (COGS) + último snapshot. Quando
// sku_pricing ainda não existe, herda fallbacks de workspace_financial_settings
// (mesma estratégia de recomputeAbcSnapshot).
//
// PUT: upsert em sku_pricing. Recalcula preco_minimo_calc e preco_alvo_calc.

import { NextRequest, NextResponse } from "next/server";
import { computeComposition } from "@/lib/pricing/composition";
import { requireAuth, requireAdmin } from "@/lib/pricing/supabase";
import { getCategoryAvgCogs } from "@/lib/pricing/category-cost";

type FinSettings = {
  product_cost_pct: number | null;
  tax_pct: number | null;
  other_expenses_pct: number | null;
  custo_frete_medio_brl: number | null;
};

async function loadFinancialFallbacks(
  supabase: Awaited<ReturnType<typeof requireAuth>> extends infer T
    ? T extends { supabase: infer S }
      ? S
      : never
    : never,
  workspaceId: string
): Promise<FinSettings> {
  const { data } = await (supabase as any)
    .from("workspace_financial_settings")
    .select("product_cost_pct, tax_pct, other_expenses_pct, custo_frete_medio_brl")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return {
    product_cost_pct: data?.product_cost_pct ?? null,
    tax_pct: data?.tax_pct ?? null,
    other_expenses_pct: data?.other_expenses_pct ?? null,
    custo_frete_medio_brl: data?.custo_frete_medio_brl ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    const { sku } = await params;
    const skuId = decodeURIComponent(sku).trim();
    if (!skuId) {
      return NextResponse.json({ error: "SKU vazio" }, { status: 400 });
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const [pricingRes, costRes, shelfRes, finRes, lastSnapshotRes] = await Promise.all([
      auth.supabase
        .from("sku_pricing")
        .select("*")
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .maybeSingle(),
      auth.supabase
        .from("product_costs")
        .select("cost")
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .maybeSingle(),
      auth.supabase
        .from("shelf_products")
        .select("product_id, sku, name, category, price, sale_price, image_url, in_stock, created_at")
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .limit(1)
        .maybeSingle(),
      loadFinancialFallbacks(auth.supabase, auth.workspaceId),
      auth.supabase
        .from("sku_pricing_history")
        .select("*")
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const pricing = pricingRes.data;
    const trackedCost = costRes.data?.cost != null ? Number(costRes.data.cost) : null;
    const shelf = shelfRes.data;
    const fin = finRes;
    const lastSnapshot = lastSnapshotRes.data;

    const precoCheio = Number(shelf?.price ?? 0);
    const precoPraticado = shelf?.sale_price != null ? Number(shelf.sale_price) : precoCheio;

    // COGS cascata:
    //   1. product_costs.cost (cadastrado pra este SKU)
    //   2. média de cost dos SKUs da mesma categoria
    //   3. % global do preço (last resort)
    const categoryAvg =
      trackedCost == null
        ? await getCategoryAvgCogs(auth.supabase, auth.workspaceId, shelf?.category ?? null)
        : null;
    const fallbackCost =
      trackedCost != null
        ? trackedCost
        : categoryAvg != null
          ? categoryAvg
          : fin.product_cost_pct != null && precoCheio > 0
            ? precoCheio * (Number(fin.product_cost_pct) / 100)
            : 0;
    const costSource: "tracked" | "category_avg" | "estimated" =
      trackedCost != null
        ? "tracked"
        : categoryAvg != null
          ? "category_avg"
          : "estimated";

    // Componentes editáveis — usa sku_pricing se existe, senão fallbacks
    const composition = {
      cogs: fallbackCost,
      frete_unitario: pricing?.frete_unitario != null
        ? Number(pricing.frete_unitario)
        : Number(fin.custo_frete_medio_brl ?? 0),
      marketing_unitario: Number(pricing?.marketing_unitario ?? 0),
      rateio_fixo: Number(pricing?.rateio_fixo ?? 0),
      taxas_comissoes_pct: Number(pricing?.taxas_comissoes_pct ?? 0),
      impostos_pct: pricing?.impostos_pct != null
        ? Number(pricing.impostos_pct)
        : Number(fin.tax_pct ?? 0) / 100,
      margem_alvo_pct: Number(pricing?.margem_alvo_pct ?? 0),
    };

    const calc = computeComposition(composition, precoPraticado);

    return NextResponse.json({
      sku: skuId,
      product: shelf
        ? {
            product_id: shelf.product_id,
            name: shelf.name,
            category: shelf.category,
            preco_de: precoCheio,
            preco_por: precoPraticado,
            image_url: shelf.image_url,
            in_stock: shelf.in_stock !== false,
            created_at: shelf.created_at,
          }
        : null,
      composition,
      composition_persisted: pricing != null,
      calc,
      last_snapshot: lastSnapshot,
      cost_source: costSource,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    const { sku } = await params;
    const skuId = decodeURIComponent(sku).trim();
    if (!skuId) {
      return NextResponse.json({ error: "SKU vazio" }, { status: 400 });
    }

    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const composition = {
      cogs: Number(body.cogs ?? 0),
      frete_unitario: Number(body.frete_unitario ?? 0),
      marketing_unitario: Number(body.marketing_unitario ?? 0),
      rateio_fixo: Number(body.rateio_fixo ?? 0),
      taxas_comissoes_pct: Number(body.taxas_comissoes_pct ?? 0),
      impostos_pct: Number(body.impostos_pct ?? 0),
      margem_alvo_pct: Number(body.margem_alvo_pct ?? 0),
    };

    const calc = computeComposition(composition);

    const { data, error } = await auth.supabase
      .from("sku_pricing")
      .upsert(
        {
          workspace_id: auth.workspaceId,
          sku: skuId,
          frete_unitario: composition.frete_unitario,
          marketing_unitario: composition.marketing_unitario,
          rateio_fixo: composition.rateio_fixo,
          taxas_comissoes_pct: composition.taxas_comissoes_pct,
          impostos_pct: composition.impostos_pct,
          margem_alvo_pct: composition.margem_alvo_pct,
          preco_minimo_calc: Number.isFinite(calc.preco_minimo) ? calc.preco_minimo : null,
          preco_alvo_calc: Number.isFinite(calc.preco_alvo) ? calc.preco_alvo : null,
          source: body.source ?? "manual",
          notes: body.notes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,sku" }
      )
      .select()
      .single();

    if (error) {
      console.error("[Pricing SKU] Upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Persiste COGS em product_costs também (fonte canônica usada pelo ABC).
    if (composition.cogs > 0) {
      await auth.supabase.from("product_costs").upsert(
        {
          workspace_id: auth.workspaceId,
          sku: skuId,
          cost: composition.cogs,
          source: body.source ?? "manual",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,sku" }
      );
    }

    return NextResponse.json({ ...data, calc });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
