import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { fetchAllSupabasePages } from "@/lib/reviews/pagination";
import { createAdminClient } from "@/lib/supabase-admin";

type ProductReviewCountRow = {
  product_id: string | null;
};

// Lista produtos ativos do catálogo + nº de avaliações publicadas (pra escolher
// na geração com IA — produtos com poucas avaliações aparecem primeiro).
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    const all: { product_id: string; name: string | null }[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await admin
        .from("shelf_products")
        .select("product_id, name")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as { product_id: string; name: string | null }[]));
      if (data.length < PAGE) break;
    }

    const revs = await fetchAllSupabasePages<ProductReviewCountRow>(async (from, to) => {
      const { data, error } = await admin
        .from("reviews")
        .select("product_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return { data: data as ProductReviewCountRow[] | null, error };
    });
    const counts: Record<string, number> = {};
    for (const r of revs) if (r.product_id) counts[r.product_id] = (counts[r.product_id] || 0) + 1;

    const products = all
      .map((p) => ({ product_id: String(p.product_id), name: p.name, review_count: counts[String(p.product_id)] || 0 }))
      .sort((a, b) => a.review_count - b.review_count || String(a.name).localeCompare(String(b.name)));

    return NextResponse.json({ products });
  } catch (e) {
    return handleAuthError(e);
  }
}
