// POST /api/pricing/engine/apply — aplica decisões aprovadas na VNDA.
//
// Body: { ids?: string[] }  (default: todas com status='approved' no workspace)
//
// Para cada decisão:
//   1. PATCH sale_price na VNDA via updateVndaSalePriceByReference
//   2. Atualiza shelf_products.sale_price localmente (mantém consistência
//      enquanto o webhook VNDA não reflete)
//   3. Marca sku_pricing_history.status='applied' + applied_at
//
// Falhas individuais não param o lote — cada SKU tem status_reason atualizado.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/pricing/supabase";
import { getVndaConfig, updateVndaSalePriceByReference } from "@/lib/vnda-api";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const ids: string[] | null = Array.isArray(body.ids) ? body.ids : null;

    let query = auth.supabase
      .from("sku_pricing_history")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("status", "approved");
    if (ids && ids.length > 0) query = query.in("id", ids);

    const { data: rows, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ applied: 0, failed: 0, items: [] });
    }

    const config = await getVndaConfig(auth.workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "VNDA não configurado para este workspace" },
        { status: 400 }
      );
    }

    let applied = 0;
    let failed = 0;
    const items: Array<{ id: string; sku: string; ok: boolean; message: string }> = [];

    for (const row of rows) {
      const newPrice =
        row.preco_por != null && Number(row.preco_por) > 0 ? Number(row.preco_por) : null;
      const result = await updateVndaSalePriceByReference(config, row.sku, newPrice);

      if (result.ok) {
        applied += 1;
        // Atualiza sale_price local pra UI refletir antes do webhook VNDA chegar
        await auth.supabase
          .from("shelf_products")
          .update({ sale_price: newPrice })
          .eq("workspace_id", auth.workspaceId)
          .eq("sku", row.sku);

        await auth.supabase
          .from("sku_pricing_history")
          .update({
            status: "applied",
            applied_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      } else {
        failed += 1;
        await auth.supabase
          .from("sku_pricing_history")
          .update({ status_reason: `VNDA: ${result.message}` })
          .eq("id", row.id);
      }

      items.push({ id: row.id, sku: row.sku, ok: result.ok, message: result.message });
    }

    return NextResponse.json({ applied, failed, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
