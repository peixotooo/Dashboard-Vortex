import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { grantReviewReward, grantAdsBonus } from "@/lib/reviews/rewards";

const ALLOWED_STATUS = ["published", "pending", "rejected", "hidden"];
const ALLOWED_ADS = ["none", "pending", "accepted", "rejected"];

// Modera uma avaliação: muda status (publicar/ocultar/rejeitar) ou adiciona
// resposta da loja.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const body = await request.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json({ error: "status inválido" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.reply_body !== undefined) {
      patch.reply_body = body.reply_body || null;
      patch.reply_at = body.reply_body ? new Date().toISOString() : null;
    }
    if (body.title !== undefined) patch.title = body.title;
    if (body.body !== undefined) patch.body = body.body;
    if (body.ads_status !== undefined) {
      if (!ALLOWED_ADS.includes(body.ads_status)) {
        return NextResponse.json({ error: "ads_status inválido" }, { status: 400 });
      }
      patch.ads_status = body.ads_status;
    }

    const admin = createAdminClient();
    // Estado anterior pra detectar transições (publicação / aceite de ADS).
    const { data: prev } = await admin
      .from("reviews")
      .select("status, ads_status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const { data, error } = await admin
      .from("reviews")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Gamificação (best-effort, não bloqueia a resposta de moderação):
    // - ao PUBLICAR pela 1ª vez → concede recompensa de foto/vídeo.
    // - ao ACEITAR o vídeo p/ ADS → concede o bônus de ADS.
    if (body.status === "published" && prev?.status !== "published") {
      grantReviewReward(workspaceId, id).catch(() => {});
    }
    if (body.ads_status === "accepted" && prev?.ads_status !== "accepted") {
      grantAdsBonus(workspaceId, id).catch(() => {});
    }

    return NextResponse.json({ review: data });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;

    const admin = createAdminClient();
    const { error } = await admin
      .from("reviews")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleAuthError(e);
  }
}
