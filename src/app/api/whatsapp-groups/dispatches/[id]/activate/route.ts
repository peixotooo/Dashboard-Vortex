// src/app/api/whatsapp-groups/dispatches/[id]/activate/route.ts
//
// Ativa um dispatch em status='draft'. Transiciona pra:
//   - scheduled (se scheduled_at no futuro) → cron dispara na data
//   - queued (caso contrário) → cron dispara no próximo tick
//
// Body opcional: { scheduled_at } — sobrescreve a data antes de ativar.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request
      .json()
      .catch(() => ({} as { scheduled_at?: string | null }));
    const admin = createAdminClient();

    const { data: dispatch } = await admin
      .from("wapi_group_dispatches")
      .select("id, status, scheduled_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!dispatch)
      return NextResponse.json(
        { error: "Dispatch nao encontrado" },
        { status: 404 }
      );
    if (dispatch.status !== "draft") {
      return NextResponse.json(
        { error: "So e possivel ativar disparos em rascunho." },
        { status: 400 }
      );
    }

    let scheduledAt: Date | null = null;
    if (typeof body?.scheduled_at === "string" && body.scheduled_at) {
      const parsed = new Date(body.scheduled_at);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "scheduled_at invalido" },
          { status: 400 }
        );
      }
      scheduledAt = parsed;
    } else if (dispatch.scheduled_at) {
      scheduledAt = new Date(dispatch.scheduled_at);
    }

    const now = new Date();
    const nextStatus =
      scheduledAt && scheduledAt > now ? "scheduled" : "queued";

    const updates: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "scheduled" && scheduledAt) {
      updates.scheduled_at = scheduledAt.toISOString();
    } else {
      // Vai pra fila — limpa scheduled_at vencido, cron pega no proximo tick.
      updates.scheduled_at = null;
    }

    const { error: upErr } = await admin
      .from("wapi_group_dispatches")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft");
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (error) {
    return handleAuthError(error);
  }
}
