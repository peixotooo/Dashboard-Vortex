import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, max-age=60",
  "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
  "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
};

type StoreReviewHighlightRow = {
  rating: number | string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string | null;
};

function displayName(name: string | null): string {
  if (!name) return "Cliente";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

function cleanComment(comment: string | null): string {
  return (comment || "")
    .replace(/(?:\s*\n\s*)?\[[^\]]*(?:Local:|Processo:|Entrega:|Atendimento:)[\s\S]*?\]\s*$/g, "")
    .replace(/\?{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function isGoodHomeHighlight(body: string): boolean {
  if (body.length < 32) return false;
  if (/^(otim[ao]s?|boa|bom|excelente|top|show|ok|gostei)[.! ]*$/i.test(body)) return false;
  return !/\b(demorad[ao]?|atrasad[ao]?|atraso|falta|faltou|defeito|encolheu|problema|ruim|p[eé]ssim[ao]|por[eé]m|esticad[ao]?|poderia|mas|cr[ií]tica|esgotad[oa]|pequen[ao]|apertad[ao]|larg[ao])\b|\bmuito\s+grand[ea]\b/i.test(body);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const requestedLimit = Number(searchParams.get("limit")) || 12;
  const limit = Math.max(4, Math.min(requestedLimit, 16));

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }

  const settings = await getReviewSettings(auth.workspaceId);
  if (!settings.widget_enabled) {
    return NextResponse.json(
      { enabled: false },
      { headers: CACHE_HEADERS }
    );
  }

  const admin = createAdminClient();
  const fetchLimit = Math.min(limit * 6, 80);

  const [totalPublished, totalPositive, totalFiveStar, reviewsResult] = await Promise.all([
    admin
      .from("store_reviews")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", auth.workspaceId)
      .eq("status", "published"),
    admin
      .from("store_reviews")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", auth.workspaceId)
      .eq("status", "published")
      .gte("rating", 4),
    admin
      .from("store_reviews")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", auth.workspaceId)
      .eq("status", "published")
      .eq("rating", 5),
    admin
      .from("store_reviews")
      .select("rating, comment, author_name, created_at")
      .eq("workspace_id", auth.workspaceId)
      .eq("status", "published")
      .gte("rating", 4)
      .not("comment", "is", null)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(fetchLimit),
  ]);

  if (totalPublished.error) {
    return NextResponse.json({ error: totalPublished.error.message }, { status: 500, headers: CORS_HEADERS });
  }
  if (totalPositive.error) {
    return NextResponse.json({ error: totalPositive.error.message }, { status: 500, headers: CORS_HEADERS });
  }
  if (totalFiveStar.error) {
    return NextResponse.json({ error: totalFiveStar.error.message }, { status: 500, headers: CORS_HEADERS });
  }
  if (reviewsResult.error) {
    return NextResponse.json({ error: reviewsResult.error.message }, { status: 500, headers: CORS_HEADERS });
  }

  const positiveCount = totalPositive.count ?? 0;
  const fiveStarCount = totalFiveStar.count ?? 0;
  const positiveRatingAverage = positiveCount > 0
    ? Number((((fiveStarCount * 5) + ((positiveCount - fiveStarCount) * 4)) / positiveCount).toFixed(1))
    : 4.7;

  const reviews = ((reviewsResult.data || []) as StoreReviewHighlightRow[])
    .map((review) => ({
      rating: Number(review.rating) || 5,
      body: truncate(cleanComment(review.comment)),
      author: displayName(review.author_name),
      date: review.created_at,
    }))
    .filter((review) => isGoodHomeHighlight(review.body))
    .slice(0, limit);

  return NextResponse.json(
    {
      enabled: reviews.length > 0,
      summary: {
        total_published: totalPublished.count ?? 0,
        total_positive: positiveCount,
        positive_rating_average: Math.max(4.7, Math.min(positiveRatingAverage, 5)),
        min_rating: 4,
      },
      reviews,
      settings: {
        star_color: settings.star_color,
        accent_color: settings.accent_color,
      },
    },
    { headers: CACHE_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}
