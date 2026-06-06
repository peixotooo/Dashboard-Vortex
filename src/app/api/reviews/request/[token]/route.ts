import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function loadRequest(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_requests")
    .select("id, workspace_id, order_id, order_code, product_id, product_name, product_image, product_url, customer_name, customer_email, status, review_id")
    .eq("token", token)
    .maybeSingle();
  return { admin, req: data };
}

// Dados da landing de coleta (público, identificado pelo token).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const { req } = await loadRequest(token);
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });

  const settings = await getReviewSettings(req.workspace_id);
  const firstName = (req.customer_name || "").trim().split(/\s+/)[0] || null;

  return NextResponse.json(
    {
      already_completed: req.status === "completed" || !!req.review_id,
      customer_name: firstName,
      product: {
        id: req.product_id,
        name: req.product_name,
        image: req.product_image,
        url: req.product_url,
      },
      ask_media: settings.request_ask_media,
      ads_enabled: settings.ads_enabled,
      collect_store_review: settings.collect_store_review,
      accent_color: settings.accent_color,
      star_color: settings.star_color,
      rewards: settings.rewards_enabled
        ? { photo: settings.reward_photo_amount, video: settings.reward_video_amount, video_ads: settings.reward_video_ads_amount }
        : null,
    },
    { headers: CORS }
  );
}

// Submissão da avaliação pela landing (token-scoped — não precisa de API key).
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const { admin, req } = await loadRequest(token);
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  if (req.status === "completed" || req.review_id) {
    return NextResponse.json({ error: "already_completed" }, { status: 409, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Escolha uma nota de 1 a 5." }, { status: 400, headers: CORS });
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Escreva sua avaliação." }, { status: 400, headers: CORS });

  const media = Array.isArray(body.media)
    ? (body.media as unknown[])
        .map((m) => {
          const it = m as { url?: unknown; type?: unknown };
          const url = typeof it?.url === "string" ? it.url : "";
          if (!/^https?:\/\//i.test(url)) return null;
          return { url, type: it?.type === "video" ? "video" : "image" };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  // Moderação obrigatória: TODA avaliação entra como 'pending' e só aparece na
  // loja depois de aprovada no admin (mesmo vinda de um comprador verificado).
  const status = "pending";

  // Gamificação: classifica a mídia e consentimento de ADS (só pra vídeo).
  const settings = await getReviewSettings(req.workspace_id);
  const hasVideo = media.some((m) => m && (m as { type: string }).type === "video");
  const mediaKind = hasVideo ? "video" : media.length > 0 ? "photo" : "none";
  const adsConsent = mediaKind === "video" && body.ads_consent === true && settings.ads_enabled;
  const adsStatus = adsConsent ? "pending" : "none";

  const { data: review, error } = await admin
    .from("reviews")
    .insert({
      workspace_id: req.workspace_id,
      source: "native",
      product_id: req.product_id,
      product_name: req.product_name,
      product_image: req.product_image,
      product_url: req.product_url,
      rating: Math.round(rating),
      title: typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null,
      body: text.slice(0, 4000),
      author_name: typeof body.author_name === "string" && body.author_name.trim() ? body.author_name.trim().slice(0, 120) : req.customer_name,
      author_email: req.customer_email, // necessário pra creditar a recompensa
      verified_buyer: true, // veio de uma compra real (régua)
      media,
      media_kind: mediaKind,
      ads_consent: adsConsent,
      ads_status: adsStatus,
      status,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  // Avaliação da LOJA (experiência/entrega), separada da do produto. Mesma
  // página, registro próprio em store_reviews. Uma por pedido (upsert).
  const storeRating = Number(body.store_rating);
  if (settings.collect_store_review && Number.isFinite(storeRating) && storeRating >= 1 && storeRating <= 5) {
    await admin.from("store_reviews").upsert(
      {
        workspace_id: req.workspace_id,
        order_id: req.order_id,
        order_code: req.order_code,
        rating: Math.round(storeRating),
        comment: typeof body.store_comment === "string" ? body.store_comment.trim().slice(0, 2000) || null : null,
        author_name: typeof body.author_name === "string" && body.author_name.trim() ? body.author_name.trim().slice(0, 120) : req.customer_name,
        author_email: req.customer_email,
        status,
        review_request_id: req.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,order_id" }
    );
  }

  await admin
    .from("review_requests")
    .update({ status: "completed", completed_at: new Date().toISOString(), review_id: review.id, updated_at: new Date().toISOString() })
    .eq("id", req.id);

  return NextResponse.json({ ok: true, moderated: status === "pending" }, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
