// GET /api/pricing/elasticity/[sku] — coeficientes de elasticidade por canal
// + dados do produto pra simulador.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";
import { computeElasticityBySku } from "@/lib/pricing/elasticity";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    const { sku } = await params;
    const skuId = decodeURIComponent(sku).trim();
    if (!skuId) return NextResponse.json({ error: "SKU vazio" }, { status: 400 });

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const days = Math.min(365, Math.max(14, parseInt(searchParams.get("days") || "90", 10)));

    const [elasticity, productRes, pricingRes] = await Promise.all([
      computeElasticityBySku(auth.supabase, auth.workspaceId, skuId, days),
      auth.supabase
        .from("shelf_products")
        .select("sku, product_id, name, price, sale_price, category")
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .limit(1)
        .maybeSingle(),
      auth.supabase
        .from("sku_pricing")
        .select(
          "frete_unitario, marketing_unitario, rateio_fixo, taxas_comissoes_pct, impostos_pct"
        )
        .eq("workspace_id", auth.workspaceId)
        .eq("sku", skuId)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      sku: skuId,
      product: productRes.data ?? null,
      pricing: pricingRes.data ?? null,
      channels: elasticity.channels,
      days,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
