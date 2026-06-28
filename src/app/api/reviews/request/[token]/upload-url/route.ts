import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generateKey, createPresignedUploadUrl, getPublicUrl } from "@/lib/b2-storage";

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
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;
const rateBuckets = new Map<string, { resetAt: number; count: number }>();

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 80);
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  const bucket =
    current && current.resetAt > now
      ? current
      : { resetAt: now + RATE_WINDOW_MS, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, value] of rateBuckets.entries()) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }
  return bucket.count <= RATE_LIMIT;
}

// Presigned upload pra mídia da avaliação (foto/vídeo), validado pelo token da
// régua. O cliente faz PUT direto no B2 e devolve a public_url no submit.
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: CORS });
  }
  if (!checkRateLimit(`${token}:${clientIp(request)}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("review_requests")
    .select("id, workspace_id, status, review_id")
    .eq("token", token)
    .maybeSingle();

  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  if (req.status === "completed" || req.review_id) {
    return NextResponse.json({ error: "already_completed" }, { status: 409, headers: CORS });
  }

  let body: { filename?: string; content_type?: string; file_size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const contentType = String(body.content_type || "");
  if (!Object.prototype.hasOwnProperty.call(MIME_LIMITS, contentType)) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado." }, { status: 400, headers: CORS });
  }
  const fileSize = Number(body.file_size);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: "file_size_required" }, { status: 400, headers: CORS });
  }
  if (fileSize > MIME_LIMITS[contentType]) {
    return NextResponse.json({ error: "Arquivo muito grande." }, { status: 413, headers: CORS });
  }

  const key = generateKey(body.filename || "review-media", `reviews/${req.workspace_id}`);
  try {
    const uploadUrl = await createPresignedUploadUrl(key, contentType, fileSize);
    return NextResponse.json(
      { upload_url: uploadUrl, public_url: getPublicUrl(key), type: contentType.startsWith("video/") ? "video" : "image" },
      { headers: CORS }
    );
  } catch (e) {
    console.error("[reviews/upload-url]", e instanceof Error ? e.message : "Erro no upload");
    return NextResponse.json({ error: "Erro no upload" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
