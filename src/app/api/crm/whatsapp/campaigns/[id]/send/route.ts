import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { recheckTemplateOnMeta } from "@/lib/whatsapp-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();

    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;

    // Verify campaign exists and belongs to workspace
    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, template_id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.status !== "draft") {
      return NextResponse.json({ error: "Campaign already started" }, { status: 400 });
    }

    // Re-check template against Meta before queueing — guards against
    // category drift to MARKETING (much higher per-msg cost).
    let recheck = null as Awaited<ReturnType<typeof recheckTemplateOnMeta>> | null;
    if (campaign.template_id) {
      recheck = await recheckTemplateOnMeta(workspaceId, campaign.template_id);
      if (
        !force &&
        recheck.ok &&
        recheck.previousCategory &&
        recheck.previousCategory !== "MARKETING" &&
        recheck.currentCategory === "MARKETING"
      ) {
        return NextResponse.json(
          {
            error: "template_category_drift",
            message: `O template foi reclassificado pela Meta de ${recheck.previousCategory} para MARKETING — o custo por mensagem aumentou. Confirme novamente para enviar.`,
            recheck,
          },
          { status: 409 }
        );
      }
      if (recheck.ok && recheck.currentStatus && recheck.currentStatus !== "APPROVED") {
        return NextResponse.json(
          {
            error: "template_not_approved",
            message: `O template está com status "${recheck.currentStatus}" na Meta — não pode ser enviado.`,
            recheck,
          },
          { status: 409 }
        );
      }
    }

    // Update status to queued
    await admin
      .from("wa_campaigns")
      .update({ status: "queued", started_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    return NextResponse.json({ ok: true, status: "queued", recheck });
  } catch (error) {
    return handleAuthError(error);
  }
}
