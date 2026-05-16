// GET /api/pricing/skus — lista paginada de SKUs do workspace com flag de
// pricing cadastrado (LEFT JOIN com sku_pricing) e último snapshot.
//
// Usado pela tela landing /pricing pra mostrar quantos SKUs já têm composição
// cadastrada vs pendentes. Query simples — paginação por offset.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const status = searchParams.get("status"); // 'all' | 'configured' | 'pending'
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "30", 10) || 30));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);

    let query = auth.supabase
      .from("shelf_products")
      .select(
        "product_id, sku, name, category, price, sale_price, image_url, in_stock, created_at",
        { count: "exact" }
      )
      .eq("workspace_id", auth.workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (q.length > 0) {
      const safe = q.replace(/[%,()]/g, " ");
      query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,product_id.ilike.%${safe}%`);
    }

    const { data: shelf, count, error: shelfError } = await query;
    if (shelfError) {
      console.error("[Pricing SKUs] shelf error:", shelfError);
      return NextResponse.json({ error: shelfError.message }, { status: 500 });
    }

    const skus = (shelf ?? []).map((p) => p.sku).filter((s): s is string => !!s);
    if (skus.length === 0) {
      return NextResponse.json({ items: [], count: count ?? 0 });
    }

    const [pricingRes, costsRes] = await Promise.all([
      auth.supabase
        .from("sku_pricing")
        .select("sku, margem_alvo_pct, preco_minimo_calc, preco_alvo_calc, updated_at")
        .eq("workspace_id", auth.workspaceId)
        .in("sku", skus),
      auth.supabase
        .from("product_costs")
        .select("sku, cost")
        .eq("workspace_id", auth.workspaceId)
        .in("sku", skus),
    ]);

    const pricingMap = new Map<string, NonNullable<typeof pricingRes.data>[number]>();
    for (const row of pricingRes.data ?? []) pricingMap.set(row.sku, row);
    const costsMap = new Map<string, number>();
    for (const row of costsRes.data ?? []) costsMap.set(row.sku, Number(row.cost));

    const items = (shelf ?? []).map((p) => {
      const skuKey = p.sku || p.product_id;
      const pricing = p.sku ? pricingMap.get(p.sku) : undefined;
      const cogs = p.sku ? costsMap.get(p.sku) : undefined;
      const precoDe = Number(p.price ?? 0);
      const precoPor = p.sale_price != null ? Number(p.sale_price) : precoDe;
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
        has_pricing: pricing != null,
        cogs_tracked: cogs != null,
        cogs,
        preco_minimo_calc: pricing?.preco_minimo_calc != null ? Number(pricing.preco_minimo_calc) : null,
        preco_alvo_calc: pricing?.preco_alvo_calc != null ? Number(pricing.preco_alvo_calc) : null,
        margem_alvo_pct: pricing?.margem_alvo_pct != null ? Number(pricing.margem_alvo_pct) : null,
      };
    });

    const filtered = status === "configured"
      ? items.filter((i) => i.has_pricing)
      : status === "pending"
        ? items.filter((i) => !i.has_pricing)
        : items;

    return NextResponse.json({ items: filtered, count: count ?? items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
