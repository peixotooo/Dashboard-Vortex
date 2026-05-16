// GET /api/pricing/sku/[sku]/history — timeline de snapshots de um SKU.
//
// Usado pela tela individual pra plotar idade, cobertura, preço de, preço por
// e margem ao longo do tempo.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/pricing/supabase";

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
    const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") || "90", 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await auth.supabase
      .from("sku_pricing_history")
      .select(
        "snapshot_date, idade_dias, cobertura_dias, stock_units, vendas_dia_unidades, preco_de, preco_por, desconto_pct, margem_pct, evento, pilar_ativo, status, status_reason"
      )
      .eq("workspace_id", auth.workspaceId)
      .eq("sku", skuId)
      .gte("snapshot_date", since)
      .order("snapshot_date", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
