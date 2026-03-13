import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { getRecommendations } from "@/lib/shelves/algorithms";

// Cache durations per algorithm (seconds)
const CACHE_TTL: Record<string, number> = {
  bestsellers: 300,
  news: 600,
  offers: 600,
  most_popular: 300,
  last_viewed: 0,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const algorithm = searchParams.get("algorithm");
  const consumerId = searchParams.get("consumer_id") || undefined;
  const productId = searchParams.get("product_id") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "12", 10), 50);

  if (!algorithm) {
    return NextResponse.json(
      { error: "Missing algorithm parameter" },
      { status: 400 }
    );
  }

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const products = await getRecommendations({
      workspaceId: auth.workspaceId,
      algorithm,
      consumerId,
      productId,
      limit,
    });

    const ttl = CACHE_TTL[algorithm] ?? 300;
    const headers: HeadersInit = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (ttl > 0) {
      headers["Cache-Control"] = `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`;
    } else {
      headers["Cache-Control"] = "no-store";
    }

    return NextResponse.json({ products, algorithm }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Shelves Recommend]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
