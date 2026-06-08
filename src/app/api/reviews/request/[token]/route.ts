import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings, DEFAULT_REVIEW_SETTINGS } from "@/lib/reviews/settings";

// Token reservado: renderiza a landing com dados de exemplo (sem tocar no banco)
// pra o admin pré-visualizar. As configs reais vêm via ?ws=<workspaceId>.
const PREVIEW_TOKEN = "preview";
async function previewSettings(reqUrl: string) {
  const wsId = new URL(reqUrl).searchParams.get("ws");
  return wsId ? await getReviewSettings(wsId) : { workspace_id: "", ...DEFAULT_REVIEW_SETTINGS };
}

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type SubmittedReview = { product_id?: unknown; rating?: unknown; body?: unknown; media?: unknown; ads_consent?: unknown; custom_fields?: unknown };

function fieldKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("pt-BR") : "";
}

function requiredFieldLabels(settings: { form_fields?: { label?: string }[] }): string[] {
  return Array.isArray(settings.form_fields)
    ? settings.form_fields.map((f) => f.label).filter((label): label is string => typeof label === "string" && label.trim().length > 0)
    : [];
}

function filledCustomFieldNames(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const f of raw as unknown[]) {
    const it = f as { name?: unknown; values?: unknown };
    const name = fieldKey(it?.name);
    const hasValue = Array.isArray(it?.values) && (it.values as unknown[]).some((v) => typeof v === "string" && v.trim().length > 0);
    if (name && hasValue) out.add(name);
  }
  return out;
}

function validateRequiredFields(reviews: SubmittedReview[], settings: { form_fields?: { label?: string }[] }): string | null {
  const labels = requiredFieldLabels(settings);
  if (labels.length === 0) return null;
  for (const r of reviews) {
    const rating = Number(r.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    const present = filledCustomFieldNames(r.custom_fields);
    const missing = labels.find((label) => !present.has(fieldKey(label)));
    if (missing) return `Preencha o campo "${missing}" em todos os produtos avaliados.`;
  }
  return null;
}

async function loadRequest(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_requests")
    .select("id, workspace_id, order_id, order_code, product_id, product_name, product_image, product_url, products, customer_name, customer_email, status, review_id")
    .eq("token", token)
    .maybeSingle();
  return { admin, req: data };
}

// Dados da landing de coleta (público, identificado pelo token).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  if (token === PREVIEW_TOKEN) {
    const settings = await previewSettings(_req.url);
    return NextResponse.json(
      {
        already_completed: false,
        preview: true,
        customer_name: null,
        product: { id: null, name: "Produto de exemplo (pré-visualização)", image: null, url: null },
        products: [
          { id: "exemplo-1", name: "Camiseta Dry-Fit (exemplo)", image: null, url: null },
          { id: "exemplo-2", name: "Shorts de Treino (exemplo)", image: null, url: null },
        ],
        ask_media: settings.request_ask_media,
        ads_enabled: settings.ads_enabled,
        collect_store_review: settings.collect_store_review,
        form_fields: settings.form_fields,
        accent_color: settings.accent_color,
        star_color: settings.star_color,
        rewards: settings.rewards_enabled
          ? { photo: settings.reward_photo_amount, video: settings.reward_video_amount, video_ads: settings.reward_video_ads_amount }
          : null,
      },
      { headers: CORS }
    );
  }

  const { req } = await loadRequest(token);
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });

  const settings = await getReviewSettings(req.workspace_id);
  const firstName = (req.customer_name || "").trim().split(/\s+/)[0] || null;

  // Todos os produtos do pedido (quiz por etapas). Pedidos antigos sem `products`
  // caem no produto único das colunas legadas.
  const rawProducts = Array.isArray(req.products) ? req.products : null;
  const products = rawProducts && rawProducts.length
    ? rawProducts.map((p: { product_id?: string; name?: string | null; image?: string | null; url?: string | null }) => ({
        id: p.product_id ?? null,
        name: p.name ?? null,
        image: p.image ?? null,
        url: p.url ?? null,
      }))
    : [{ id: req.product_id, name: req.product_name, image: req.product_image, url: req.product_url }];

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
      products,
      ask_media: settings.request_ask_media,
      ads_enabled: settings.ads_enabled,
      collect_store_review: settings.collect_store_review,
      form_fields: settings.form_fields,
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

  // Pré-visualização: calcula a recompensa de forma fiel (mesma regra do fluxo
  // real) pra mostrar o estado de sucesso, mas NÃO grava nada no banco.
  if (token === PREVIEW_TOKEN) {
    const settings = await previewSettings(request.url);
    let pbody: Record<string, unknown> = {};
    try { pbody = await request.json(); } catch {}
    const previewAuthorName = typeof pbody.author_name === "string" ? pbody.author_name.trim() : "";
    if (!previewAuthorName) {
      return NextResponse.json({ error: "Preencha seu nome." }, { status: 400, headers: CORS });
    }
    // Melhor mídia entre os produtos avaliados (uma recompensa por pedido).
    const plist: SubmittedReview[] = Array.isArray(pbody.reviews) && pbody.reviews.length
      ? (pbody.reviews as SubmittedReview[])
      : [{ rating: pbody.rating, body: pbody.body, media: pbody.media, ads_consent: pbody.ads_consent, custom_fields: pbody.custom_fields }];
    if (!plist.some((r) => {
      const rating = Number(r.rating);
      return Number.isFinite(rating) && rating >= 1 && rating <= 5;
    })) {
      return NextResponse.json({ error: "Avalie ao menos um produto com estrelas." }, { status: 400, headers: CORS });
    }
    const missingFields = validateRequiredFields(plist, settings);
    if (missingFields) return NextResponse.json({ error: missingFields }, { status: 400, headers: CORS });
    const storeRating = Number(pbody.store_rating);
    if (settings.collect_store_review && (!Number.isFinite(storeRating) || storeRating < 1 || storeRating > 5)) {
      return NextResponse.json({ error: "Avalie também a experiência com a loja." }, { status: 400, headers: CORS });
    }
    let bestRank = 0, bestKind = "none", bestAds = false;
    for (const r of plist) {
      const media = Array.isArray(r.media) ? r.media : [];
      const kind = media.some((m) => m?.type === "video") ? "video" : media.length ? "photo" : "none";
      const ads = kind === "video" && r.ads_consent === true;
      const rank = kind === "video" && ads ? 3 : kind === "video" ? 2 : kind === "photo" ? 1 : 0;
      if (rank > bestRank) { bestRank = rank; bestKind = kind; bestAds = ads; }
    }
    const pReward = settings.rewards_enabled
      ? (bestKind === "video" ? settings.reward_video_amount : bestKind === "photo" ? settings.reward_photo_amount : 0)
      : 0;
    const pAdsMax =
      settings.rewards_enabled && bestKind === "video" && bestAds && settings.reward_video_ads_amount > settings.reward_video_amount
        ? settings.reward_video_ads_amount
        : null;
    return NextResponse.json(
      { ok: true, moderated: true, preview: true, reward: pReward > 0 ? { amount: pReward, ads_max: pAdsMax } : null },
      { headers: CORS }
    );
  }

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

  const settings = await getReviewSettings(req.workspace_id);

  // Normaliza pra uma lista de avaliações POR PRODUTO. Aceita o formato novo
  // (reviews: [...]) do quiz e o legado (campos no topo = 1 produto só).
  const inList: SubmittedReview[] = Array.isArray(body.reviews) && body.reviews.length
    ? (body.reviews as SubmittedReview[])
    : [{ product_id: req.product_id, rating: body.rating, body: body.body, media: body.media, ads_consent: body.ads_consent, custom_fields: body.custom_fields }];

  // Produtos válidos do pedido (pra casar id/nome/imagem de cada avaliação).
  const reqProducts = Array.isArray(req.products) && req.products.length
    ? (req.products as { product_id?: string; name?: string | null; image?: string | null; url?: string | null }[])
    : [{ product_id: req.product_id || undefined, name: req.product_name, image: req.product_image, url: req.product_url }];
  const productById = new Map(reqProducts.map((p) => [String(p.product_id), p]));

  function sanitizeMedia(raw: unknown) {
    return Array.isArray(raw)
      ? (raw as unknown[])
          .map((m) => {
            const it = m as { url?: unknown; type?: unknown };
            const url = typeof it?.url === "string" ? it.url : "";
            if (!/^https?:\/\//i.test(url)) return null;
            return { url, type: it?.type === "video" ? "video" : "image" };
          })
          .filter(Boolean)
          .slice(0, 8)
      : [];
  }
  function sanitizeFields(raw: unknown) {
    return Array.isArray(raw)
      ? (raw as unknown[])
          .map((f) => {
            const it = f as { name?: unknown; values?: unknown };
            const name = typeof it?.name === "string" ? it.name.slice(0, 60) : "";
            const values = Array.isArray(it?.values) ? (it.values as unknown[]).filter((v) => typeof v === "string").map((v) => (v as string).slice(0, 80)) : [];
            return name && values.length ? { name, values } : null;
          })
          .filter(Boolean)
          .slice(0, 20)
      : [];
  }

  // Moderação obrigatória: TODA avaliação entra como 'pending'.
  const status = "pending";
  const authorName = typeof body.author_name === "string" && body.author_name.trim() ? body.author_name.trim().slice(0, 120) : null;
  if (!authorName) {
    return NextResponse.json({ error: "Preencha seu nome." }, { status: 400, headers: CORS });
  }
  const missingFields = validateRequiredFields(inList, settings);
  if (missingFields) return NextResponse.json({ error: missingFields }, { status: 400, headers: CORS });
  // Chave do pedido — usada pra deduplicar a recompensa (uma por pedido).
  const referenceOrder = req.order_code || req.order_id || null;

  // Uma linha de review por produto avaliado. O texto é opcional na landing:
  // estrelas + campos estruturados já bastam para gerar prova social útil.
  const rows: Record<string, unknown>[] = [];
  let bestRank = -1, bestKind = "none", bestAds = false;
  for (const r of inList) {
    const rating = Number(r.rating);
    const text = typeof r.body === "string" ? r.body.trim() : "";
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue; // pula produto não avaliado
    const media = sanitizeMedia(r.media);
    const hasVideo = media.some((m) => m && (m as { type: string }).type === "video");
    const mediaKind = hasVideo ? "video" : media.length > 0 ? "photo" : "none";
    const adsConsent = mediaKind === "video" && r.ads_consent === true && settings.ads_enabled;
    const pid = r.product_id != null ? String(r.product_id) : (req.product_id || null);
    const prod = (pid && productById.get(pid)) || reqProducts[0];
    const canonicalProductId = prod?.product_id ? String(prod.product_id) : pid;
    rows.push({
      workspace_id: req.workspace_id,
      source: "native",
      product_id: canonicalProductId,
      product_name: prod?.name ?? req.product_name,
      product_image: prod?.image ?? req.product_image,
      product_url: prod?.url ?? req.product_url,
      rating: Math.round(rating),
      title: null,
      body: text ? text.slice(0, 4000) : null,
      author_name: authorName,
      author_email: req.customer_email, // necessário pra creditar a recompensa
      verified_buyer: true, // veio de uma compra real (régua)
      reference_order: referenceOrder, // dedup da recompensa por pedido
      custom_fields: sanitizeFields(r.custom_fields),
      media,
      media_kind: mediaKind,
      ads_consent: adsConsent,
      ads_status: adsConsent ? "pending" : "none",
      status,
    });
    // Melhor mídia do pedido (foto < vídeo < vídeo p/ ADS) — base da recompensa única.
    const rank = mediaKind === "video" && adsConsent ? 3 : mediaKind === "video" ? 2 : mediaKind === "photo" ? 1 : 0;
    if (rank > bestRank) { bestRank = rank; bestKind = mediaKind; bestAds = adsConsent; }
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Avalie ao menos um produto com estrelas." }, { status: 400, headers: CORS });
  }
  const requiredProductIds = reqProducts.map((p) => p.product_id).filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (requiredProductIds.length > 0) {
    const submittedIds = new Set(rows.map((r) => (typeof r.product_id === "string" ? r.product_id : "")).filter(Boolean));
    const missingProduct = requiredProductIds.find((id) => !submittedIds.has(id));
    if (missingProduct) {
      return NextResponse.json({ error: "Avalie todos os produtos do pedido." }, { status: 400, headers: CORS });
    }
  } else if (rows.length < reqProducts.length) {
    return NextResponse.json({ error: "Avalie todos os produtos do pedido." }, { status: 400, headers: CORS });
  }

  const storeRating = Number(body.store_rating);
  if (settings.collect_store_review && (!Number.isFinite(storeRating) || storeRating < 1 || storeRating > 5)) {
    return NextResponse.json({ error: "Avalie também a experiência com a loja." }, { status: 400, headers: CORS });
  }

  const { data: inserted, error } = await admin.from("reviews").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  // Avaliação da LOJA (experiência/entrega), separada das de produto. Uma por pedido (upsert).
  if (settings.collect_store_review && Number.isFinite(storeRating) && storeRating >= 1 && storeRating <= 5) {
    await admin.from("store_reviews").upsert(
      {
        workspace_id: req.workspace_id,
        order_id: req.order_id,
        order_code: req.order_code,
        rating: Math.round(storeRating),
        comment: typeof body.store_comment === "string" ? body.store_comment.trim().slice(0, 2000) || null : null,
        author_name: authorName,
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
    .update({ status: "completed", completed_at: new Date().toISOString(), review_id: inserted?.[0]?.id ?? null, updated_at: new Date().toISOString() })
    .eq("id", req.id);

  // Revela a recompensa (surpresa) só agora — UMA por pedido, conforme a melhor
  // mídia enviada. Pode subir pro valor de ADS se a loja selecionar o vídeo
  // (substitui, não soma) — mostramos como possibilidade, sem prometer.
  const rewardAmount = settings.rewards_enabled
    ? (bestKind === "video" ? settings.reward_video_amount : bestKind === "photo" ? settings.reward_photo_amount : 0)
    : 0;
  const adsMax = settings.rewards_enabled && bestKind === "video" && bestAds && settings.reward_video_ads_amount > settings.reward_video_amount
    ? settings.reward_video_ads_amount
    : null;

  return NextResponse.json(
    { ok: true, moderated: status === "pending", reward: rewardAmount > 0 ? { amount: rewardAmount, ads_max: adsMax } : null },
    { headers: CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
