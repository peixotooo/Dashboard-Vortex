import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getReviewSettings } from "@/lib/reviews/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Submissão pública de avaliação (widget na loja "Escrever avaliação", e também
// a landing da régua de comunicação). Validado por shelf_api_keys. Entra como
// 'published' ou 'pending' conforme review_settings.auto_publish.
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400, headers: CORS_HEADERS });
  }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Nota (1-5) é obrigatória." }, { status: 400, headers: CORS_HEADERS });
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Escreva sua avaliação." }, { status: 400, headers: CORS_HEADERS });
  }

  const settings = await getReviewSettings(auth.workspaceId);
  const admin = createAdminClient();

  // Se veio de um review_request (token), liga os dois e marca como completed.
  const requestToken = typeof body.request_token === "string" ? body.request_token : null;
  let reqRow: { id: string; product_id: string | null; product_name: string | null; product_image: string | null; product_url: string | null; customer_name: string | null } | null = null;
  if (requestToken) {
    const { data } = await admin
      .from("review_requests")
      .select("id, product_id, product_name, product_image, product_url, customer_name")
      .eq("workspace_id", auth.workspaceId)
      .eq("token", requestToken)
      .maybeSingle();
    reqRow = data;
  }

  // Sanitiza mídia: aceita só URLs http(s).
  const media = Array.isArray(body.media)
    ? (body.media as unknown[])
        .map((m) => {
          const item = m as { url?: unknown; type?: unknown };
          const url = typeof item?.url === "string" ? item.url : "";
          if (!/^https?:\/\//i.test(url)) return null;
          const type = item?.type === "video" ? "video" : "image";
          return { url, type };
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const status = settings.auto_publish ? "published" : "pending";

  const { data: review, error } = await admin
    .from("reviews")
    .insert({
      workspace_id: auth.workspaceId,
      source: "native",
      product_id: (body.product_id as string) ?? reqRow?.product_id ?? null,
      product_name: (body.product_name as string) ?? reqRow?.product_name ?? null,
      product_image: (body.product_image as string) ?? reqRow?.product_image ?? null,
      product_url: (body.product_url as string) ?? reqRow?.product_url ?? null,
      rating: Math.round(rating),
      title: typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null,
      body: text.slice(0, 4000),
      author_name: typeof body.author_name === "string" ? body.author_name.trim().slice(0, 120) : reqRow?.customer_name ?? null,
      author_email: typeof body.author_email === "string" ? body.author_email.trim().slice(0, 200) : null,
      verified_buyer: Boolean(reqRow), // veio da régua = comprador verificado
      custom_fields: Array.isArray(body.custom_fields) ? body.custom_fields : [],
      media,
      status,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  // Fecha o review_request, se houver.
  if (reqRow) {
    await admin
      .from("review_requests")
      .update({ status: "completed", completed_at: new Date().toISOString(), review_id: review.id, updated_at: new Date().toISOString() })
      .eq("id", reqRow.id);
  }

  return NextResponse.json(
    { ok: true, status, moderated: status === "pending" },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}
