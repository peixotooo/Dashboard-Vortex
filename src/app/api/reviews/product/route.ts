import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Colunas seguras pro público — NUNCA author_email/IP (LGPD).
const PUBLIC_COLUMNS =
  "id, rating, title, body, author_name, verified_buyer, custom_fields, media, likes, reviewed_at, reply_body, reply_at, created_at";

type SortKey = "recent" | "helpful" | "rating_high" | "rating_low";

// Abrevia o nome pra exibição: "Maria Silva Santos" -> "Maria S." (privacidade).
function displayName(name: string | null): string {
  if (!name) return "Cliente";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const productId = searchParams.get("product_id");

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }
  if (!productId) {
    return NextResponse.json({ error: "Missing product_id" }, { status: 400, headers: CORS_HEADERS });
  }

  const settings = await getReviewSettings(auth.workspaceId);
  if (!settings.widget_enabled) {
    return NextResponse.json({ enabled: false }, { headers: { ...CORS_HEADERS, "Cache-Control": "public, s-maxage=120" } });
  }

  const sort = (searchParams.get("sort") as SortKey) || "recent";
  const perPage = Math.min(Number(searchParams.get("limit")) || settings.reviews_per_page, 50);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  const admin = createAdminClient();

  // 1) Agregados (todas as publicadas do produto): média + distribuição + count.
  const { data: allRatings } = await admin
    .from("reviews")
    .select("rating, title")
    .eq("workspace_id", auth.workspaceId)
    .eq("product_id", productId)
    .eq("status", "published");

  const ratings = allRatings || [];
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  const titleFreq = new Map<string, number>();
  for (const r of ratings) {
    const n = Number(r.rating);
    if (n >= 1 && n <= 5) {
      distribution[n]++;
      sum += n;
    }
    const t = (r.title || "").trim();
    if (t && t.length <= 24) titleFreq.set(t, (titleFreq.get(t) || 0) + 1);
  }
  const count = ratings.length;
  const average = count ? Number((sum / count).toFixed(1)) : 0;

  // "Topics" = títulos curtos mais frequentes (as pílulas cinza do topo).
  const topics = Array.from(titleFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  // 2) Página de avaliações com ordenação.
  let query = admin
    .from("reviews")
    .select(PUBLIC_COLUMNS)
    .eq("workspace_id", auth.workspaceId)
    .eq("product_id", productId)
    .eq("status", "published")
    .range(offset, offset + perPage - 1);

  if (sort === "helpful") query = query.order("likes", { ascending: false }).order("reviewed_at", { ascending: false });
  else if (sort === "rating_high") query = query.order("rating", { ascending: false }).order("reviewed_at", { ascending: false });
  else if (sort === "rating_low") query = query.order("rating", { ascending: true }).order("reviewed_at", { ascending: false });
  else query = query.order("reviewed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

  const { data: pageRows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  const reviews = (pageRows || []).map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    author: displayName(r.author_name),
    verified: r.verified_buyer,
    custom_fields: settings.show_custom_fields ? r.custom_fields : [],
    media: r.media,
    likes: r.likes,
    date: r.reviewed_at || r.created_at,
    reply: r.reply_body ? { body: r.reply_body, at: r.reply_at } : null,
  }));

  return NextResponse.json(
    {
      enabled: true,
      summary: { average, count, distribution },
      topics,
      reviews,
      offset,
      limit: perPage,
      has_more: offset + reviews.length < count,
      settings: {
        accent_color: settings.accent_color,
        star_color: settings.star_color,
        show_verified_badge: settings.show_verified_badge,
        show_custom_fields: settings.show_custom_fields,
        anchor_selector: settings.anchor_selector,
        reviews_per_page: settings.reviews_per_page,
      },
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}
