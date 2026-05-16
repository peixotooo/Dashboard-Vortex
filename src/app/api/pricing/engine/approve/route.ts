// POST /api/pricing/engine/approve — aprova/rejeita decisões em lote.
//
// Body: { ids: string[], action: 'approve' | 'reject' }
// Apenas marca status. O push pra VNDA acontece em /apply.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/pricing/supabase";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const action: "approve" | "reject" = body.action;

    if (ids.length === 0) {
      return NextResponse.json({ error: "Nenhum id fornecido" }, { status: 400 });
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action inválida" }, { status: 400 });
    }

    const status = action === "approve" ? "approved" : "rejected";
    const { data, error } = await auth.supabase
      .from("sku_pricing_history")
      .update({
        status,
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("workspace_id", auth.workspaceId)
      .in("id", ids)
      .eq("status", "pending")
      .select("id, sku, status");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: data?.length ?? 0, items: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
