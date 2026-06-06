import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function loadRequest(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_requests")
    .select("id, workspace_id, product_id, product_name, product_image, product_url, customer_name, status, review_id")
    .eq("token", token)
    .maybeSingle();
  return { admin, req: data };
}

// Dados da landing de coleta (público, identificado pelo token).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const { req } = await loadRequest(token);
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });

  const settings = await getReviewSettings(req.workspace_id);
  const firstName = (req.customer_name || "").trim().split(/\s+/)[0] || null;

  return NextResponse.json(
    {
      already_completed: req.status === "completed" || !!req.review_id,
      customer_name: firstName,
      product: {
        id: req.product_id,
        name: req.product_name,
        image: req.product_image,
        url: req.product_url,
      },
      ask_media: settings.request_ask_media,
      accent_color: settings.accent_color,
      star_color: settings.star_color,
    },
    { headers: CORS }
  );
}

// Submissão da avaliação pela landing (token-scoped — não precisa de API key).
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const { admin, req } = await loadRequest(token);
  if (!req) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });
  if (req.status === "completed" || req.review_id) {
    return NextResponse.json({ error: "already_completed" }, { status: 409, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS });
  }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Escolha uma nota de 1 a 5." }, { status: 400, headers: CORS });
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Escreva sua avaliação." }, { status: 400, headers: CORS });

  const media = Array.isArray(body.media)
    ? (body.media as unknown[])
        .map((m) => {
          const it = m as { url?: unknown; type?: unknown };
          const url = typeof it?.url === "string" ? it.url : "";
          if (!/^https?:\/\//i.test(url)) return null;
          return { url, type: it?.type === "video" ? "video" : "image" };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const settings = await getReviewSettings(req.workspace_id);
  const status = settings.auto_publish ? "published" : "pending";

  const { data: review, error } = await admin
    .from("reviews")
    .insert({
      workspace_id: req.workspace_id,
      source: "native",
      product_id: req.product_id,
      product_name: req.product_name,
      product_image: req.product_image,
      product_url: req.product_url,
      rating: Math.round(rating),
      title: typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null,
      body: text.slice(0, 4000),
      author_name: typeof body.author_name === "string" && body.author_name.trim() ? body.author_name.trim().slice(0, 120) : req.customer_name,
      verified_buyer: true, // veio de uma compra real (régua)
      media,
      status,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  await admin
    .from("review_requests")
    .update({ status: "completed", completed_at: new Date().toISOString(), review_id: review.id, updated_at: new Date().toISOString() })
    .eq("id", req.id);

  return NextResponse.json({ ok: true, moderated: status === "pending" }, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}
