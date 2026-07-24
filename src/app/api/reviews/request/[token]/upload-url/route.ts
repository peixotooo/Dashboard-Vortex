import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generateKey, createPresignedUploadUrl, getPublicUrl } from "@/lib/b2-storage";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
  securityRateLimitHeaders,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MIME_LIMITS: Record<string, number> = {
  "image/jpeg": 12 * 1024 * 1024,
  "image/png": 12 * 1024 * 1024,
  "image/webp": 12 * 1024 * 1024,
  "image/gif": 12 * 1024 * 1024,
  "video/mp4": 80 * 1024 * 1024,
  "video/quicktime": 80 * 1024 * 1024,
  "video/webm": 80 * 1024 * 1024,
};

const MAX_BODY_BYTES = 4096;
const RATE_LIMIT = 20;

// Presigned upload pra mídia da avaliação (foto/vídeo), validado pelo token da
// régua. O cliente faz PUT direto no B2 e devolve a public_url no submit.
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_BODY_BYTES
  ) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: CORS });
  }

  const minuteLimit = await consumeSecurityRateLimit({
    scope: "reviews:upload-url:minute",
    key: `${token}:${getRequestClientIp(request)}`,
    limit: RATE_LIMIT,
    windowSeconds: 60,
  });
  const responseHeaders = {
    ...CORS,
    ...securityRateLimitHeaders(minuteLimit, RATE_LIMIT),
  };
  if (!minuteLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: responseHeaders }
    );
  }

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("review_requests")
    .select("id, workspace_id, status, review_id")
    .eq("token", token)
    .maybeSingle();

  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: responseHeaders });
  if (req.status === "completed" || req.status === "submitting" || req.review_id) {
    return NextResponse.json({ error: "already_completed" }, { status: 409, headers: responseHeaders });
  }

  let body: { filename?: string; content_type?: string; file_size?: unknown };
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "payload_too_large" },
        { status: 413, headers: responseHeaders }
      );
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: responseHeaders });
  }

  const contentType = String(body.content_type || "");
  if (!Object.prototype.hasOwnProperty.call(MIME_LIMITS, contentType)) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado." }, { status: 400, headers: responseHeaders });
  }
  const fileSize = Number(body.file_size);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: "file_size_required" }, { status: 400, headers: responseHeaders });
  }
  if (fileSize > MIME_LIMITS[contentType]) {
    return NextResponse.json({ error: "Arquivo muito grande." }, { status: 413, headers: responseHeaders });
  }

  const [dailyCount, dailyMegabytes] = await Promise.all([
    consumeSecurityRateLimit({
      scope: "reviews:upload-url:daily-count",
      key: token,
      limit: 20,
      windowSeconds: 86_400,
    }),
    consumeSecurityRateLimit({
      scope: "reviews:upload-url:daily-mb",
      key: token,
      limit: 1024,
      windowSeconds: 86_400,
      cost: Math.max(1, Math.ceil(fileSize / (1024 * 1024))),
    }),
  ]);
  if (!dailyCount.allowed || !dailyMegabytes.allowed) {
    return NextResponse.json(
      { error: "upload_limit_reached" },
      { status: 429, headers: responseHeaders }
    );
  }

  const key = generateKey(
    body.filename || "review-media",
    `reviews/${req.workspace_id}`,
    contentType
  );
  try {
    const uploadUrl = await createPresignedUploadUrl(key, contentType, fileSize);
    return NextResponse.json(
      { upload_url: uploadUrl, public_url: getPublicUrl(key), type: contentType.startsWith("video/") ? "video" : "image" },
      { headers: responseHeaders }
    );
  } catch (e) {
    console.error("[reviews/upload-url]", e instanceof Error ? e.message : "Erro no upload");
    return NextResponse.json({ error: "Erro no upload" }, { status: 500, headers: responseHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
