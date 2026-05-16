// GET /api/pricing/engine/pending — lista decisões pendentes de aprovação.
//
// Retorna rows de sku_pricing_history com status in ('pending','approved')
// para a tela de approval queue. Inclui dados do produto (nome, imagem) via
// JOIN com shelf_products.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") || "pending").split(",");
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));

    const { data: rows, error } = await auth.supabase
      .from("sku_pricing_history")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .in("status", status)
      .order("snapshot_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const skus = Array.from(new Set((rows ?? []).map((r) => r.sku)));
    const productsBySku = new Map<string, any>();
    if (skus.length > 0) {
      const { data: products } = await auth.supabase
        .from("shelf_products")
        .select("sku, product_id, name, image_url")
        .eq("workspace_id", auth.workspaceId)
        .in("sku", skus);
      for (const p of products ?? []) productsBySku.set(p.sku, p);
    }

    const items = (rows ?? []).map((r) => ({
      ...r,
      product: productsBySku.get(r.sku) ?? null,
    }));

    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
