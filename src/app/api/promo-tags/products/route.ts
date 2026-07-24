import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { computePromoTagMatches } from "@/lib/promo-tags/matcher";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const ip = getRequestClientIp(request);

  const ingress = await consumeSecurityRateLimit({
    scope: "promo-tags:products:ingress",
    key: ip,
    limit: 240,
  });
  if (!ingress.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: CORS_HEADERS }
    );
  }

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const workspaceLimit = await consumeSecurityRateLimit({
      scope: "promo-tags:products:workspace",
      key: `${auth.workspaceId}:${ip}`,
      limit: 120,
    });
    if (!workspaceLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: CORS_HEADERS }
      );
    }

    const payload = await computePromoTagMatches(auth.workspaceId);

    return NextResponse.json(payload, {
      headers: {
        ...CORS_HEADERS,
        // Shorter cache so viewers feel "live" (server recomputes baseline by hour)
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=240",
      },
    });
  } catch (error) {
    console.error(
      "[PromoTags Products]",
      error instanceof Error ? error.message : "compute_failed"
    );
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers: CORS_HEADERS }
    );
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
