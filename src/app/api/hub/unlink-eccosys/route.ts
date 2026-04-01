import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { HubProduct } from "@/types/hub";

/**
 * POST — Unlink an ML item from Eccosys.
 * Resets ecc_id, ecc_pai_sku, ecc_pai_id, linked, and restores ML SKUs.
 * Body: { ml_item_id: "MLB..." }
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { ml_item_id } = body as { ml_item_id: string };

  if (!ml_item_id) {
    return NextResponse.json({ error: "ml_item_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch all hub rows for this ML item
  const { data: rows, error } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ml_item_id", ml_item_id);

  if (error || !rows || rows.length === 0) {
    return NextResponse.json(
      { error: `Anuncio ML "${ml_item_id}" nao encontrado no Hub.` },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  let updated = 0;

  for (const row of rows as HubProduct[]) {
    // Restore ML-format SKU
    const newSku = row.ml_variation_id
      ? `ML-${ml_item_id}-${row.ml_variation_id}`
      : `ML-${ml_item_id}`;

    // Check if restored SKU already exists (avoid unique constraint violation)
    const { data: existing } = await supabase
      .from("hub_products")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("sku", newSku)
      .neq("id", row.id)
      .limit(1);

    const canRestoreSku = !existing || existing.length === 0;

    await supabase
      .from("hub_products")
      .update({
        ...(canRestoreSku && row.sku !== newSku ? { sku: newSku } : {}),
        ecc_id: null,
        ecc_pai_sku: canRestoreSku ? (row.ml_variation_id ? `ML-${ml_item_id}` : null) : row.ecc_pai_sku,
        ecc_pai_id: null,
        linked: false,
        updated_at: now,
      })
      .eq("id", row.id);
    updated++;
  }

  // Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "link_eccosys",
    entity: "product",
    entity_id: ml_item_id,
    direction: "ml_to_eccosys",
    status: "ok",
    details: {
      action: "unlink",
      ml_item_id,
      rows_updated: updated,
    },
  });

  return NextResponse.json({ unlinked: updated, ml_item_id });
}
