import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/crm/segments/state/summary
//
// Retorna agregação de clientes/receita por UF + flag de se já tem
// lista auto_segment materializada pra cada estado. Usado pela
// página /crm/estados pra renderizar o tilemap + side panel.

export const maxDuration = 30;

type RpcRow = {
  state: string;
  customer_count: number;
  total_revenue: number;
};

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    // Agregação via RPC (migration-100)
    const { data: rows, error: rpcErr } = await admin
      .rpc("crm_state_summary", { p_workspace_id: workspaceId });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // Listas auto_segment do tipo 'state' do workspace
    const { data: lists, error: listsErr } = await admin
      .from("crm_contact_lists")
      .select("id, name, total_count, auto_segment")
      .eq("workspace_id", workspaceId)
      .eq("auto_segment->>type", "state");
    if (listsErr) {
      return NextResponse.json({ error: listsErr.message }, { status: 500 });
    }

    const listByState = new Map<string, { id: string; name: string; total: number }>();
    for (const l of lists ?? []) {
      const seg = l.auto_segment as { state?: string };
      const uf = (seg?.state || "").toUpperCase();
      if (uf) listByState.set(uf, {
        id: l.id as string,
        name: l.name as string,
        total: (l.total_count as number) || 0,
      });
    }

    const states = (rows as RpcRow[] ?? []).map((r) => ({
      state: r.state,
      customer_count: Number(r.customer_count),
      total_revenue: Number(r.total_revenue),
      list: r.state === "(sem estado)" ? null : (listByState.get(r.state.toUpperCase()) ?? null),
    }));

    return NextResponse.json({
      states,
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return handleAuthError(error);
  }
}
