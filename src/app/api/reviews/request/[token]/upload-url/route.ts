import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generateKey, createPresignedUploadUrl, getPublicUrl } from "@/lib/b2-storage";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Presigned upload pra mídia da avaliação (foto/vídeo), validado pelo token da
// régua. O cliente faz PUT direto no B2 e devolve a public_url no submit.
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("review_requests")
    .select("id, status, review_id")
    .eq("token", token)
    .maybeSingle();

  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  if (req.status === "completed" || req.review_id) {
    return NextResponse.json({ error: "already_completed" }, { status: 409, headers: CORS });
  }

  let body: { filename?: string; content_type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const contentType = String(body.content_type || "");
  if (!/^image\/|^video\//.test(contentType)) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado." }, { status: 400, headers: CORS });
  }

  const key = generateKey(body.filename || "review-media");
  try {
    const uploadUrl = await createPresignedUploadUrl(key, contentType);
    return NextResponse.json(
      { upload_url: uploadUrl, public_url: getPublicUrl(key), type: contentType.startsWith("video/") ? "video" : "image" },
      { headers: CORS }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro no upload" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
