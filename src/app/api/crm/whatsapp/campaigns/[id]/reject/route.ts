// src/app/api/crm/whatsapp/campaigns/[id]/reject/route.ts
//
// Rejeita uma campanha em pending_approval. Transiciona pra "cancelled"
// (preservando as mensagens enfileiradas pra histórico) e registra quem
// rejeitou + motivo.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json().catch(() => ({} as { reason?: string }));
    const admin = createAdminClient();

    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Essa campanha não está pendente de aprovação." },
        { status: 400 }
      );
    }

    const { error: upErr } = await admin
      .from("wa_campaigns")
      .update({
        status: "cancelled",
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        rejection_reason: body?.reason?.trim() || null,
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
