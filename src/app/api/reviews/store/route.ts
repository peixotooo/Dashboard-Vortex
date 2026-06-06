import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// Lista avaliações da LOJA (experiência), pro admin moderar. Separadas das
// avaliações de produto (tabela store_reviews).
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 200);

    const admin = createAdminClient();
    let q = admin
      .from("store_reviews")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);

    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Resumo: média + distribuição das publicadas.
    const published = (data || []).filter((r) => r.status === "published");
    const sum = published.reduce((s, r) => s + (Number(r.rating) || 0), 0);
    const average = published.length ? Number((sum / published.length).toFixed(1)) : 0;

    return NextResponse.json({
      reviews: data || [],
      total: count ?? 0,
      summary: { average, published: published.length },
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
