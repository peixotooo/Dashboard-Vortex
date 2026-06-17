import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { grantReviewReward } from "@/lib/reviews/rewards";

const ALLOWED_STATUS = ["published", "pending", "rejected", "hidden"];
const ALLOWED_ADS = ["none", "pending", "accepted", "rejected"];

type ReviewMedia = { url: string; type: "image" | "video" };

function normalizeMedia(raw: unknown): ReviewMedia[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const it = m as { url?: unknown; type?: unknown };
      if (typeof it.url !== "string" || !it.url) return null;
      return { url: it.url, type: it.type === "video" ? "video" : "image" } as ReviewMedia;
    })
    .filter((m): m is ReviewMedia => !!m);
}

// Modera uma avaliação: muda status (publicar/ocultar/rejeitar) ou adiciona
// resposta da loja.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const body = await request.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const admin = createAdminClient();

    // Estado anterior pra detectar transições (publicação / aceite de ADS) e
    // permitir ocultar uma mídia específica sem rejeitar a avaliação inteira.
    const { data: prev } = await admin
      .from("reviews")
      .select("status, ads_status, ads_consent, media")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

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
    if (body.hide_media_index !== undefined) {
      const index = Number(body.hide_media_index);
      const currentMedia = normalizeMedia(prev?.media);
      if (!Number.isInteger(index) || index < 0 || index >= currentMedia.length) {
        return NextResponse.json({ error: "mídia inválida" }, { status: 400 });
      }
      const nextMedia = currentMedia.filter((_, i) => i !== index);
      const hasVideo = nextMedia.some((m) => m.type === "video");
      patch.media = nextMedia;
      patch.media_kind = hasVideo ? "video" : nextMedia.length > 0 ? "photo" : "none";
      if (!hasVideo) {
        patch.ads_consent = false;
        patch.ads_status = "none";
      } else {
        patch.ads_consent = !!prev?.ads_consent;
        if (patch.ads_status === undefined) patch.ads_status = prev?.ads_consent ? (prev?.ads_status || "pending") : "none";
      }
    }

    const { data, error } = await admin
      .from("reviews")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Gamificação (best-effort, não bloqueia a resposta de moderação):
    // ao PUBLICAR pela 1ª vez, concede UM único cashback conforme a mídia e a
    // decisão de ADS (ads_status), que o admin define no mesmo "aprovar".
    // foto → valor de foto; vídeo → valor de vídeo; vídeo aceito p/ ADS → valor de ADS.
    if (body.status === "published" && prev?.status !== "published") {
      grantReviewReward(workspaceId, id).catch(() => {});
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
