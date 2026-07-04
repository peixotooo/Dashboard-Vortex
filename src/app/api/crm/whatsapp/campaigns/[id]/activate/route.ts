// src/app/api/crm/whatsapp/campaigns/[id]/activate/route.ts
//
// Ativa uma campanha em status='draft'. Transiciona pra:
//   - scheduled (se scheduled_at no futuro) → cron envia na data
//   - queued (caso contrário) → cron pega no próximo tick
//
// Opcionalmente aceita { scheduled_at } no body pra atualizar a data
// no momento da ativação (útil quando o draft foi guardado sem data
// ou com data já vencida).

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
    const body = await request.json().catch(() => ({} as { scheduled_at?: string | null }));
    const admin = createAdminClient();

    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, scheduled_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.status !== "draft") {
      return NextResponse.json(
        { error: "Só é possível ativar campanhas em rascunho." },
        { status: 400 }
      );
    }

    // Usa nova data se vier no body; senão mantém a do draft.
    let scheduledAt: Date | null = null;
    if (typeof body?.scheduled_at === "string" && body.scheduled_at) {
      const parsed = new Date(body.scheduled_at);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "scheduled_at inválido" }, { status: 400 });
      }
      scheduledAt = parsed;
    } else if (campaign.scheduled_at) {
      scheduledAt = new Date(campaign.scheduled_at);
    }

    const now = new Date();
    const nextStatus =
      scheduledAt && scheduledAt > now ? "scheduled" : "queued";

    const updates: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "scheduled" && scheduledAt) {
      updates.scheduled_at = scheduledAt.toISOString();
    } else {
      // Indo direto pra fila: limpa scheduled_at vencido e marca started_at.
      updates.scheduled_at = null;
      updates.started_at = now.toISOString();
    }

    const { error: upErr } = await admin
      .from("wa_campaigns")
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
