import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// Galeria de mídias dos clientes (admin): achata todas as fotos/vídeos das
// avaliações, cada uma com o contexto da avaliação que a originou (produto,
// autor, nota, consentimento/decisão de ADS). Pensada pra curar vídeos p/ ADS.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const url = new URL(request.url);
    const type = url.searchParams.get("type"); // 'photo' | 'video' | null
    const ads = url.searchParams.get("ads"); // 'consent' | 'accepted' | null
    const productId = url.searchParams.get("product_id");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 400, 1000);

    let q = admin
      .from("reviews")
      .select("id, product_id, product_name, author_name, rating, status, body, media, media_kind, ads_consent, ads_status, reward_status, reward_amount, created_at, reviewed_at")
      .eq("workspace_id", workspaceId)
      // Tem mídia. NÃO filtra por media_kind: as avaliações importadas da
      // Yourviews têm fotos em `media` mas media_kind='none' (não era setado na
      // importação) — filtrar por media_kind escondia todas elas. Mesmo filtro
      // jsonb usado na galeria pública do widget (/api/reviews/product).
      .not("media", "eq", "[]")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (productId) q = q.eq("product_id", productId);
    if (ads === "consent") q = q.eq("ads_consent", true);
    if (ads === "accepted") q = q.eq("ads_status", "accepted");
    // O filtro por tipo (foto/vídeo) é aplicado por ITEM de mídia abaixo, porque
    // media_kind não é confiável nas importadas.

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    type MediaEntry = { url?: string; type?: string };
    const items: Record<string, unknown>[] = [];
    for (const r of data || []) {
      const media = Array.isArray(r.media) ? (r.media as MediaEntry[]) : [];
      media.forEach((m, i) => {
        if (!m?.url) return;
        const mtype = m.type === "video" ? "video" : "image";
        if (type === "video" && mtype !== "video") return;
        if (type === "photo" && mtype !== "image") return;
        items.push({
          review_id: r.id,
          index: i,
          url: m.url,
          type: mtype,
          product_id: r.product_id,
          product_name: r.product_name,
          author_name: r.author_name,
          rating: r.rating,
          review_status: r.status,
          body: r.body,
          ads_consent: r.ads_consent,
          ads_status: r.ads_status,
          reward_status: r.reward_status,
          reward_amount: r.reward_amount,
          created_at: r.created_at,
        });
      });
    }

    // Resumo rápido pra cabeçalho da aba.
    const summary = {
      total: items.length,
      videos: items.filter((m) => m.type === "video").length,
      photos: items.filter((m) => m.type === "image").length,
      ads_pending: items.filter((m) => m.type === "video" && m.ads_status === "pending").length,
      ads_accepted: items.filter((m) => m.type === "video" && m.ads_status === "accepted").length,
    };

    return NextResponse.json({ items, summary });
  } catch (e) {
    return handleAuthError(e);
  }
}
