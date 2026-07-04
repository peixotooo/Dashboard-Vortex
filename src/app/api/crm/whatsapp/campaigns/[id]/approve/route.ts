// src/app/api/crm/whatsapp/campaigns/[id]/approve/route.ts
//
// Aprova uma campanha em pending_approval. Transiciona pra:
//   - scheduled (se scheduled_at no futuro) → cron envia na data
//   - queued (caso contrário) → cron pega no próximo tick
//
// Quem submeteu pra aprovação não pode aprovar a própria campanha.

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
    if (campaign.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Essa campanha não está pendente de aprovação." },
        { status: 400 }
      );
    }

    // Decide próximo status: scheduled se data futura, senão queued.
    const nextStatus =
      campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date()
        ? "scheduled"
        : "queued";

    const now = new Date().toISOString();
    const { error: upErr } = await admin
      .from("wa_campaigns")
      .update({
        status: nextStatus,
        approved_by: userId,
        approved_at: now,
        ...(nextStatus === "queued" ? { started_at: now } : {}),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending_approval");
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (error) {
    return handleAuthError(error);
  }
}
