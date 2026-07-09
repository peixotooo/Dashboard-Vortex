import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/controladoria/meta — classificações, contas e metas (para filtros/forms)
//   ?partners_q=texto → busca de parceiros (autocomplete)
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const p = request.nextUrl.searchParams;
    const supabase = createAdminClient();

    const partnersQ = p.get("partners_q");
    if (partnersQ !== null) {
      const { data, error } = await supabase
        .from("fin_partners")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .ilike("name", `%${partnersQ}%`)
        .order("name")
        .limit(20);
      if (error) throw error;
      return NextResponse.json({ partners: data ?? [] });
    }

    const [cls, accounts, settings] = await Promise.all([
      supabase
        .from("fin_classifications")
        .select("id, path, name, category, subcategory, flow, is_transfer, is_depreciation, is_active")
        .eq("workspace_id", workspaceId)
        .order("category")
        .order("name"),
      supabase
        .from("fin_bank_accounts")
        .select("id, code, bank_name, agency, account_number, archived_at")
        .eq("workspace_id", workspaceId)
        .order("code"),
      supabase.from("fin_settings").select("goals, cash_planning").eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    if (cls.error) throw cls.error;
    if (accounts.error) throw accounts.error;

    return NextResponse.json({
      classifications: cls.data ?? [],
      accounts: accounts.data ?? [],
      settings: settings.data ?? { goals: {}, cash_planning: {} },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

// PATCH /api/controladoria/meta — atualiza metas (fin_settings.goals)
export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("fin_settings")
      .upsert(
        { workspace_id: workspaceId, goals: body.goals ?? {}, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id" }
      )
      .select("goals")
      .single();
    if (error) throw error;
    return NextResponse.json({ goals: data.goals });
  } catch (err) {
    return handleAuthError(err);
  }
}
