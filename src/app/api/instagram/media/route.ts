import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const maxDuration = 30;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

function allowedCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "cdninstagram.com" ||
    host.endsWith(".cdninstagram.com") ||
    host === "fbcdn.net" ||
    host.endsWith(".fbcdn.net")
  );
}

function allowedInstagramMediaEndpoint(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host !== "www.instagram.com" && host !== "instagram.com") return false;
  return /^\/(p|reel|tv)\/[^/]+\/media\/?$/.test(url.pathname);
}

function allowedSourceUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return allowedCdnHost(url.hostname) || allowedInstagramMediaEndpoint(url);
}

function allowedFinalUrl(url: URL): boolean {
  return url.protocol === "https:" && allowedCdnHost(url.hostname);
}

export async function GET(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get("url") || "";
  let mediaUrl: URL;
  try {
    mediaUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  if (!allowedSourceUrl(mediaUrl)) {
    return NextResponse.json({ error: "Origem não permitida" }, { status: 400 });
  }

  const upstream = await fetch(mediaUrl.toString(), {
    headers: {
      Referer: "https://www.instagram.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    redirect: "follow",
  });

  let finalUrl: URL;
  try {
    finalUrl = new URL(upstream.url || mediaUrl.toString());
  } catch {
    finalUrl = mediaUrl;
  }

  if (!allowedFinalUrl(finalUrl)) {
    return NextResponse.json({ error: "Destino não permitido" }, { status: 400 });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Instagram media ${upstream.status}: ${text.slice(0, 180)}` },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!/^(image|video)\//.test(contentType)) {
    return NextResponse.json(
      { error: `Tipo de mídia inválido: ${contentType || "desconhecido"}` },
      { status: 415 }
    );
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
