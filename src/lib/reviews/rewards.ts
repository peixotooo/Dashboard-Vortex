import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";
import { depositVndaCredit, getVndaCreditsConfigFromDb } from "@/lib/cashback/vnda-credits";

// Gamificação: concede cashback ao cliente conforme o tipo de mídia da avaliação.
//   foto (unbox)        → reward_photo_amount
//   vídeo               → reward_video_amount
//   vídeo aceito p/ ADS → reward_video_ads_amount (concede o DELTA por cima do vídeo)
// Idempotente via `reference` no /credits da VNDA + reward_status na review.

interface ReviewRow {
  id: string;
  workspace_id: string;
  author_email: string | null;
  media_kind: string;
  status: string;
  reward_tier: string | null;
  reward_status: string;
  reward_amount: number | null;
}

async function deposit(workspaceId: string, email: string, amount: number, reference: string, validityDays: number) {
  const cfg = await getVndaCreditsConfigFromDb(workspaceId);
  if (!cfg) return { ok: false, error: "VNDA credits não configurado" };
  const now = new Date();
  const validUntil = new Date(now.getTime() + validityDays * 86400_000);
  const r = await depositVndaCredit(cfg, { email, amount, reference, validFrom: now, validUntil, event: "cashback" });
  return { ok: r.ok, error: r.error };
}

/**
 * Concede a recompensa base (foto/vídeo) quando a avaliação é PUBLICADA.
 * Só roda se rewards_enabled. Best-effort: registra reward_error em falha.
 */
export async function grantReviewReward(workspaceId: string, reviewId: string): Promise<{ granted: boolean; reason?: string }> {
  const admin = createAdminClient();
  const settings = await getReviewSettings(workspaceId);
  if (!settings.rewards_enabled) return { granted: false, reason: "rewards desligado" };

  const { data } = await admin
    .from("reviews")
    .select("id, workspace_id, author_email, media_kind, status, reward_tier, reward_status, reward_amount")
    .eq("id", reviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const review = data as ReviewRow | null;
  if (!review) return { granted: false, reason: "review não encontrada" };
  if (review.status !== "published") return { granted: false, reason: "não publicada" };
  if (review.reward_status === "granted") return { granted: false, reason: "já concedida" };
  if (review.media_kind !== "photo" && review.media_kind !== "video") return { granted: false, reason: "sem mídia premiável" };
  if (!review.author_email) {
    await admin.from("reviews").update({ reward_status: "failed", reward_error: "sem email do cliente", updated_at: new Date().toISOString() }).eq("id", reviewId);
    return { granted: false, reason: "sem email" };
  }

  const tier = review.media_kind; // 'photo' | 'video'
  const amount = tier === "video" ? settings.reward_video_amount : settings.reward_photo_amount;
  if (!amount || amount <= 0) return { granted: false, reason: "valor zero" };

  const reference = `REVIEW-${tier.toUpperCase()}-${reviewId}`;
  const r = await deposit(workspaceId, review.author_email, amount, reference, settings.reward_validity_days);

  await admin.from("reviews").update(
    r.ok
      ? { reward_tier: tier, reward_status: "granted", reward_amount: amount, reward_reference: reference, reward_granted_at: new Date().toISOString(), reward_error: null, updated_at: new Date().toISOString() }
      : { reward_status: "failed", reward_error: (r.error || "falha no depósito").slice(0, 300), updated_at: new Date().toISOString() }
  ).eq("id", reviewId);

  return r.ok ? { granted: true } : { granted: false, reason: r.error };
}

/**
 * Bônus de ADS: quando o admin ACEITA o vídeo para anúncios, concede o delta
 * (reward_video_ads_amount - reward_video_amount) por cima do que já foi dado.
 */
export async function grantAdsBonus(workspaceId: string, reviewId: string): Promise<{ granted: boolean; reason?: string }> {
  const admin = createAdminClient();
  const settings = await getReviewSettings(workspaceId);
  if (!settings.rewards_enabled) return { granted: false, reason: "rewards desligado" };

  const { data } = await admin
    .from("reviews")
    .select("id, workspace_id, author_email, media_kind, status, reward_tier, reward_status, reward_amount")
    .eq("id", reviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const review = data as ReviewRow | null;
  if (!review) return { granted: false, reason: "review não encontrada" };
  if (review.media_kind !== "video") return { granted: false, reason: "não é vídeo" };
  if (review.reward_tier === "video_ads") return { granted: false, reason: "bônus já concedido" };
  if (!review.author_email) return { granted: false, reason: "sem email" };

  const delta = Math.max(0, settings.reward_video_ads_amount - settings.reward_video_amount);
  if (delta <= 0) {
    // Nada a creditar a mais, mas marca o tier como video_ads.
    await admin.from("reviews").update({ reward_tier: "video_ads", updated_at: new Date().toISOString() }).eq("id", reviewId);
    return { granted: false, reason: "delta zero" };
  }

  const reference = `REVIEW-VIDEOADS-${reviewId}`;
  const r = await deposit(workspaceId, review.author_email, delta, reference, settings.reward_validity_days);
  if (r.ok) {
    await admin.from("reviews").update({
      reward_tier: "video_ads",
      reward_status: "granted",
      reward_amount: (review.reward_amount || 0) + delta,
      reward_granted_at: new Date().toISOString(),
      reward_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", reviewId);
    return { granted: true };
  }
  await admin.from("reviews").update({ reward_error: (r.error || "falha no bônus ADS").slice(0, 300), updated_at: new Date().toISOString() }).eq("id", reviewId);
  return { granted: false, reason: r.error };
}
