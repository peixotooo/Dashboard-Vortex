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
    // Paginação por avaliação (infinite scroll) — mais recentes primeiro.
    const pageSize = Math.min(Number(url.searchParams.get("limit")) || 24, 100);
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

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
      .range(offset, offset + pageSize - 1);
    if (productId) q = q.eq("product_id", productId);
    if (ads === "consent") q = q.eq("ads_consent", true);
    if (ads === "accepted") q = q.eq("ads_status", "accepted");
    // O filtro por tipo (foto/vídeo) é aplicado por ITEM de mídia abaixo, porque
    // media_kind não é confiável nas importadas.

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const reviewsReturned = (data || []).length;

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

    const has_more = reviewsReturned === pageSize;
    const next_offset = offset + reviewsReturned;

    // Resumo (contagens baratas, head:true) só na 1ª página.
    let summary: { total_with_media: number; ads_pending: number; ads_accepted: number } | undefined;
    if (offset === 0) {
      const [tot, adsP, adsA] = await Promise.all([
        admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).not("media", "eq", "[]"),
        admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("ads_status", "pending"),
        admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("ads_status", "accepted"),
      ]);
      summary = { total_with_media: tot.count || 0, ads_pending: adsP.count || 0, ads_accepted: adsA.count || 0 };
    }

    return NextResponse.json({ items, has_more, next_offset, summary });
  } catch (e) {
    return handleAuthError(e);
  }
}
