import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    let query = supabase
      .from("shelf_products")
      .select("product_id, sku, name, category, price, sale_price, image_url, in_stock")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q.length > 0) {
      const safe = q.replace(/[%,()]/g, " ");
      query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,product_id.ilike.%${safe}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[Commercial Simulator Products] error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data ?? [])
      .filter((p) => Number(p.price ?? 0) > 0)
      .map((p) => ({
        codigo: p.sku || p.product_id,
        nome: p.name,
        precoCheio: Number(p.price ?? 0),
        salePrice: p.sale_price != null ? Number(p.sale_price) : null,
        categoria: p.category,
        imagem: p.image_url,
        inStock: p.in_stock !== false,
      }));

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
