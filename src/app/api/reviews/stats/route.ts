import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// Resumo pro topo da página de admin: total, média, distribuição por nota,
// contagem por status, e top produtos avaliados.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    // Puxa só as colunas necessárias pra agregar em memória (volume moderado).
    const { data, error } = await admin
      .from("reviews")
      .select("rating, status, source, product_id, product_name")
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data || [];
    const published = rows.filter((r) => r.status === "published");

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of published) {
      const n = Number(r.rating);
      if (n >= 1 && n <= 5) {
        distribution[n]++;
        sum += n;
      }
    }

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      bySource[r.source] = (bySource[r.source] || 0) + 1;
    }

    // Top produtos por nº de avaliações publicadas.
    const productMap = new Map<string, { product_id: string; product_name: string | null; count: number; sum: number }>();
    for (const r of published) {
      if (!r.product_id) continue;
      const key = r.product_id;
      const cur = productMap.get(key) || { product_id: key, product_name: r.product_name, count: 0, sum: 0 };
      cur.count++;
      cur.sum += Number(r.rating) || 0;
      productMap.set(key, cur);
    }
    const topProducts = Array.from(productMap.values())
      .map((p) => ({ product_id: p.product_id, product_name: p.product_name, count: p.count, average: p.count ? p.sum / p.count : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json({
      total: rows.length,
      published_count: published.length,
      average: published.length ? Number((sum / published.length).toFixed(2)) : 0,
      distribution,
      by_status: byStatus,
      by_source: bySource,
      top_products: topProducts,
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
