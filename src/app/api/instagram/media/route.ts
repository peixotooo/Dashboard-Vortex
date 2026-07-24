import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";

export const maxDuration = 30;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

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

async function fetchAllowedMedia(initialUrl: URL): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= 3; hop += 1) {
    if (
      (hop === 0 && !allowedSourceUrl(currentUrl)) ||
      (hop > 0 && !allowedFinalUrl(currentUrl))
    ) {
      throw new Error("redirect_not_allowed");
    }

    const upstream = await fetch(currentUrl.toString(), {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });

    if (upstream.status < 300 || upstream.status >= 400) {
      return upstream;
    }
    const location = upstream.headers.get("location");
    if (!location) throw new Error("redirect_without_location");
    currentUrl = new URL(location, currentUrl);
    if (!allowedFinalUrl(currentUrl)) throw new Error("redirect_not_allowed");
  }
  throw new Error("too_many_redirects");
}

export async function GET(request: NextRequest) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(request));
  } catch (error) {
    return handleAuthError(error);
  }

  const rateLimit = await consumeSecurityRateLimit({
    scope: "instagram:media-proxy",
    key: `${workspaceId}:${getRequestClientIp(request)}`,
    limit: 120,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
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

  try {
    const upstream = await fetchAllowedMedia(mediaUrl);

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
      return NextResponse.json(
        { error: "Não foi possível carregar a mídia." },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!/^(image|video)\//.test(contentType)) {
      return NextResponse.json(
        { error: "Tipo de mídia inválido." },
        { status: 415 }
      );
    }

    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_MEDIA_BYTES
    ) {
      return NextResponse.json({ error: "Mídia muito grande." }, { status: 413 });
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    if (contentLength > 0) headers.set("Content-Length", String(contentLength));

    let streamedBytes = 0;
    const limitedBody = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          streamedBytes += chunk.byteLength;
          if (streamedBytes > MAX_MEDIA_BYTES) {
            controller.error(new Error("media_too_large"));
            return;
          }
          controller.enqueue(chunk);
        },
      })
    );

    return new Response(limitedBody, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    console.error(
      "[instagram/media]",
      error instanceof Error ? error.message : "media_proxy_failed"
    );
    return NextResponse.json(
      { error: "Não foi possível carregar a mídia." },
      { status: 502 }
    );
  }
}
