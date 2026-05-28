import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/crm/customer-states
//
// Retorna mapa email → UF do último pedido. Usado pelo /crm page pra
// enriquecer o snapshot RFM (que não carrega state) e habilitar
// filtro composto por estado + comportamento.
//
// Idealmente o state morava direto em RfmCustomer no snapshot — quando
// o próximo recompute rodar, dá pra dropar esse endpoint. Mantido por
// enquanto pra não bloquear o filtro aguardando rebuild do snapshot.

export const maxDuration = 30;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

type Row = { email: string; state: string };

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const admin = createAdminClient();

    // PostgREST do Supabase cappa resposta em ~1000 linhas (db-max-rows).
    // Pra workspaces grandes (Bulking tem ~30k clientes com state) precisamos
    // paginar em chunks de 1000. Range fica no Range header via .range().
    const PAGE = 1000;
    const map: Record<string, string> = {};
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .rpc("crm_customer_state_latest", { p_workspace_id: workspaceId })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data as Row[]) ?? [];
      for (const r of rows) {
        if (r.email && r.state) map[r.email] = r.state.toUpperCase();
      }
      if (rows.length < PAGE) break;
      from += PAGE;
      // hard cap defensivo — 100k linhas é mais que qualquer workspace plausível
      if (from > 100_000) break;
    }
    return NextResponse.json({ map }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[customer-states]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
