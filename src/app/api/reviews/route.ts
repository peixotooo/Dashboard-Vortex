import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// Lista avaliações pro admin (moderação). Filtros: status, product_id, source,
// busca textual. Paginado. Autenticado (membro do workspace).
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status"); // published | pending | rejected | hidden
    const productId = searchParams.get("product_id");
    const source = searchParams.get("source"); // yourviews | native
    const search = searchParams.get("q");
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

    const admin = createAdminClient();
    let query = admin
      .from("reviews")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (productId) query = query.eq("product_id", productId);
    if (source) query = query.eq("source", source);
    if (search) {
      // Sanitiza os chars da gramática de filtro do PostgREST pra o input não
      // injetar condições extras no .or() (mesmo padrão de hub/products).
      const s = search.replace(/[%_,().*]/g, "");
      if (s) query = query.or(`title.ilike.%${s}%,body.ilike.%${s}%,author_name.ilike.%${s}%`);
    }

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ reviews: data || [], total: count ?? 0, limit, offset });
  } catch (e) {
    return handleAuthError(e);
  }
}

// Cria uma avaliação manualmente pelo admin (raro; útil pra colar uma
// avaliação avulsa). Avaliações da régua entram pelo endpoint público.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();

    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return NextResponse.json({ error: "rating (1-5) é obrigatório" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("reviews")
      .insert({
        workspace_id: workspaceId,
        source: "native",
        product_id: body.product_id ?? null,
        product_name: body.product_name ?? null,
        product_url: body.product_url ?? null,
        product_image: body.product_image ?? null,
        product_sku: body.product_sku ?? null,
        rating: body.rating,
        title: body.title ?? null,
        body: body.body ?? null,
        author_name: body.author_name ?? null,
        author_email: body.author_email ?? null,
        verified_buyer: Boolean(body.verified_buyer),
        custom_fields: body.custom_fields ?? [],
        media: body.media ?? [],
        status: body.status ?? "published",
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ review: data });
  } catch (e) {
    return handleAuthError(e);
  }
}
