// GET / PATCH / DELETE /api/pricing/combos/[id]

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/pricing/supabase";
import { computeComboMetrics } from "@/lib/pricing/combos";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { data, error } = await auth.supabase
      .from("pricing_combos")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Combo não encontrado" }, { status: 404 });

    return NextResponse.json({ combo: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const allowedFields = [
      "name",
      "description",
      "combo_type",
      "sku_ids",
      "combo_size",
      "combo_price_brl",
      "discount_pct",
      "starts_at",
      "ends_at",
      "meta_faturamento_brl",
      "status",
    ];
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }

    // Recomputa métricas se mexeu nos inputs sensíveis
    if ("sku_ids" in body || "combo_size" in body || "combo_price_brl" in body) {
      const { data: existing } = await auth.supabase
        .from("pricing_combos")
        .select("sku_ids, combo_size, combo_price_brl")
        .eq("workspace_id", auth.workspaceId)
        .eq("id", id)
        .maybeSingle();

      const skus: string[] = (updates.sku_ids as string[]) ?? (existing as any)?.sku_ids ?? [];
      const size = Number(updates.combo_size ?? (existing as any)?.combo_size ?? 1);
      const price = Number(updates.combo_price_brl ?? (existing as any)?.combo_price_brl ?? 0);
      const metrics = await computeComboMetrics(
        auth.supabase,
        auth.workspaceId,
        price,
        size,
        skus
      );
      updates.cpa_breakeven_brl = metrics.cpa_breakeven_brl;
      updates.cobertura_estoque_dias = metrics.cobertura_estoque_dias;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await auth.supabase
      .from("pricing_combos")
      .update(updates)
      .eq("workspace_id", auth.workspaceId)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ combo: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const { error } = await auth.supabase
      .from("pricing_combos")
      .delete()
      .eq("workspace_id", auth.workspaceId)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
