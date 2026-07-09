import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateEngineCache } from "@/lib/controladoria/engine";

// POST /api/controladoria/lancamentos/bulk
//   { ids: string[], action: "pay" | "unpay" | "review_done" | "delete" }
// Ações em lote (equivalente ao "Ações em lote" do SenseBoard).
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const body = await request.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 5000) : [];
    const action = body.action as string;
    if (!ids.length) return NextResponse.json({ error: "nenhum lançamento selecionado" }, { status: 400 });

    const supabase = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    let patch: Record<string, unknown>;
    switch (action) {
      case "pay": patch = { paid_at: today, updated_at: new Date().toISOString() }; break;
      case "unpay": patch = { paid_at: null, updated_at: new Date().toISOString() }; break;
      case "review_done": patch = { needs_review: false, updated_at: new Date().toISOString() }; break;
      case "delete": patch = { deleted_at: new Date().toISOString() }; break;
      default: return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("fin_entries")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("id", ids)
      .select("id");
    if (error) throw error;
    invalidateEngineCache(workspaceId);
    return NextResponse.json({ affected: data?.length ?? 0 });
  } catch (err) {
    return handleAuthError(err);
  }
}
