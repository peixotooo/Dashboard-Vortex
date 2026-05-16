// GET /api/pricing/combos — lista todos os combos do workspace
// POST /api/pricing/combos — cria novo combo (recalcula métricas)

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/pricing/supabase";
import { computeComboMetrics } from "@/lib/pricing/combos";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { data, error } = await auth.supabase
      .from("pricing_combos")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .order("starts_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const skus: string[] = Array.isArray(body.sku_ids) ? body.sku_ids : [];
    const comboSize = Number(body.combo_size ?? 1);
    const comboPrice = Number(body.combo_price_brl ?? 0);

    const metrics = await computeComboMetrics(
      auth.supabase,
      auth.workspaceId,
      comboPrice,
      comboSize,
      skus
    );

    const { data, error } = await auth.supabase
      .from("pricing_combos")
      .insert({
        workspace_id: auth.workspaceId,
        name: body.name ?? "Combo sem nome",
        description: body.description ?? null,
        combo_type: body.combo_type ?? "fixed_total",
        sku_ids: skus,
        combo_size: comboSize,
        combo_price_brl: body.combo_type === "percent_off" ? null : comboPrice,
        discount_pct:
          body.combo_type === "percent_off" ? Number(body.discount_pct ?? 0) : null,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        meta_faturamento_brl: body.meta_faturamento_brl ?? null,
        cpa_breakeven_brl: metrics.cpa_breakeven_brl,
        cobertura_estoque_dias: metrics.cobertura_estoque_dias,
        status: body.status ?? "draft",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ combo: data, metrics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
