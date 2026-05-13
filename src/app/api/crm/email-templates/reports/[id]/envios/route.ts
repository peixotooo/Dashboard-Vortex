// src/app/api/crm/email-templates/reports/[id]/envios/route.ts
//
// Pagina os envios per-recipient (email_template_iporto_envios) de um
// dispatch. Filtro por status + paginação por offset/limit. Usado pela
// página de detalhe quando provider=iporto pra mostrar a tabela de
// destinatários.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const VALID_STATUSES = ["pending", "processing", "sent", "failed"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const url = new URL(req.url);

    const status = url.searchParams.get("status");
    const offset = Math.max(
      0,
      parseInt(url.searchParams.get("offset") ?? "0", 10) || 0
    );
    const limit = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100)
    );

    const sb = createAdminClient();

    // Confirma que o dispatch pertence ao workspace antes de devolver
    // qualquer envio (evita IDOR).
    const { data: dispatch } = await sb
      .from("email_template_dispatches")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (!dispatch) {
      return NextResponse.json({ error: "dispatch not found" }, { status: 404 });
    }

    let q = sb
      .from("email_template_iporto_envios")
      .select(
        "id, email, name, status, iporto_message_id, attempts, error, created_at, updated_at",
        { count: "exact" }
      )
      .eq("dispatch_id", id)
      .order("updated_at", { ascending: false });

    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      q = q.eq("status", status);
    }
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      envios: data ?? [],
      total: count ?? 0,
      offset,
      limit,
      status: status ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
