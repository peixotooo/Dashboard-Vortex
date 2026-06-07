import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";
import { depositVndaCredit, getVndaCreditsConfigFromDb } from "@/lib/cashback/vnda-credits";

// Gamificação: concede UMA recompensa por PEDIDO (não por produto), conforme a
// MELHOR mídia entre as avaliações publicadas daquele pedido:
//   foto (unbox)        → reward_photo_amount
//   vídeo               → reward_video_amount
//   vídeo aceito p/ ADS → reward_video_ads_amount (substitui o de vídeo, não soma)
// Idempotente via `reference` no /credits da VNDA (chaveado por pedido) +
// reward_status na review. Avaliações sem pedido (legado) caem no modo por-review.

interface ReviewRow {
  id: string;
  workspace_id: string;
  author_email: string | null;
  media_kind: string;
  status: string;
  ads_status: string;
  reference_order: string | null;
  reward_tier: string | null;
  reward_status: string;
  reward_amount: number | null;
}

// foto < vídeo < vídeo aceito p/ ADS.
function tierRank(kind: string, ads: string): number {
  if (kind === "video" && ads === "accepted") return 3;
  if (kind === "video") return 2;
  if (kind === "photo") return 1;
  return 0;
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
 * Concede a recompensa (uma por pedido) quando a avaliação é PUBLICADA.
 * Só roda se rewards_enabled. Best-effort: registra reward_error em falha.
 */
export async function grantReviewReward(workspaceId: string, reviewId: string): Promise<{ granted: boolean; reason?: string }> {
  const admin = createAdminClient();
  const settings = await getReviewSettings(workspaceId);
  if (!settings.rewards_enabled) return { granted: false, reason: "rewards desligado" };

  const { data } = await admin
    .from("reviews")
    .select("id, workspace_id, author_email, media_kind, status, ads_status, reference_order, reward_tier, reward_status, reward_amount")
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

  // UMA recompensa por PEDIDO: se outra avaliação do mesmo pedido já recebeu,
  // não concede de novo. O valor reflete a MELHOR mídia entre as avaliações
  // publicadas desse pedido (a aprovação acontece uma a uma na moderação).
  const orderKey = review.reference_order;
  let bestKind = review.media_kind;
  let bestAds = review.ads_status;
  if (orderKey) {
    const { data: siblings } = await admin
      .from("reviews")
      .select("id, media_kind, ads_status, reward_status, status")
      .eq("workspace_id", workspaceId)
      .eq("reference_order", orderKey);
    for (const s of siblings || []) {
      if ((s.reward_status as string) === "granted") return { granted: false, reason: "pedido já recompensado" };
    }
    for (const s of siblings || []) {
      if ((s.status as string) !== "published") continue;
      if (tierRank(s.media_kind as string, s.ads_status as string) > tierRank(bestKind, bestAds)) {
        bestKind = s.media_kind as string;
        bestAds = s.ads_status as string;
      }
    }
  }

  const adsAccepted = bestKind === "video" && bestAds === "accepted";
  const tier = bestKind === "photo" ? "photo" : adsAccepted ? "video_ads" : "video";
  const amount = bestKind === "photo"
    ? settings.reward_photo_amount
    : adsAccepted ? settings.reward_video_ads_amount : settings.reward_video_amount;
  if (!amount || amount <= 0) return { granted: false, reason: "valor zero" };

  // Referência idempotente no /credits da VNDA: por PEDIDO quando há pedido
  // (garante uma só por pedido), senão por review (legado).
  const reference = orderKey ? `REVIEW-ORDER-${orderKey}` : `REVIEW-${tier.toUpperCase()}-${reviewId}`;
  const r = await deposit(workspaceId, review.author_email, amount, reference, settings.reward_validity_days);

  await admin.from("reviews").update(
    r.ok
      ? { reward_tier: tier, reward_status: "granted", reward_amount: amount, reward_reference: reference, reward_granted_at: new Date().toISOString(), reward_error: null, updated_at: new Date().toISOString() }
      : { reward_status: "failed", reward_error: (r.error || "falha no depósito").slice(0, 300), updated_at: new Date().toISOString() }
  ).eq("id", reviewId);

  return r.ok ? { granted: true } : { granted: false, reason: r.error };
}
