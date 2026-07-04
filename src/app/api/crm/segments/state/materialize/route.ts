import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  ensureStateList,
  seedStateListFromCrmVendas,
  isValidBrState,
} from "@/lib/segments/sync";

// POST /api/crm/segments/state/materialize
// Body: { state: "SP" }
//
// Cria a contact_list auto-segmentada do UF (se ainda não existe) e
// seeda com todos os clientes já presentes em crm_vendas com aquele
// state. Dali pra frente o webhook de pedido confirmado mantém a
// lista atualizada automaticamente.
//
// É idempotente: chamar de novo num UF já materializado só pega
// clientes novos que entraram entre uma chamada e outra.

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json().catch(() => ({}));
    const state = typeof body.state === "string" ? body.state.trim().toUpperCase() : "";
    if (!isValidBrState(state)) {
      return NextResponse.json({ error: "UF inválida. Use sigla brasileira (SP, RJ, MG...)." }, { status: 400 });
    }

    const admin = createAdminClient();
    const list = await ensureStateList(admin, workspaceId, state);
    const seedStats = await seedStateListFromCrmVendas(admin, workspaceId, state, list.id);

    return NextResponse.json({
      list: { id: list.id, name: list.name, created: list.created },
      seed: seedStats,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
