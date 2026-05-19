import { NextRequest } from "next/server";

// CORS headers for public endpoints that are called from storefronts via
// `navigator.sendBeacon`. sendBeacon ALWAYS sets credentials mode to
// "include" — and the spec forbids `Access-Control-Allow-Origin: *` when
// credentials are included. Browsers block the preflight, the POST never
// fires, and our events vanish silently.
//
// Fix: echo the request's Origin header back, set
// `Access-Control-Allow-Credentials: true`, and Vary on Origin so CDNs
// cache per-origin. Storefront can be any domain (multi-tenant), so we
// trust the Origin header — these endpoints are gated by API key anyway.
export function buildCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
