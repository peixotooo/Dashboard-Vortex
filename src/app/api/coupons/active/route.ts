import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status"); // pending|active|paused|expired|cancelled|failed

  const admin = createAdminClient();
  let q = admin
    .from("promo_active_coupons")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (statusFilter) {
    q = q.eq("status", statusFilter);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with product name + url so the painel can show "Camiseta X" and a
  // clickable link instead of just the bare product_id.
  const coupons = data || [];
  const productIds = Array.from(new Set(coupons.map((c) => c.product_id).filter(Boolean)));
  if (productIds.length > 0) {
    const { data: products } = await admin
      .from("shelf_products")
      .select("product_id, name, product_url, image_url, price, sale_price")
      .eq("workspace_id", workspaceId)
      .in("product_id", productIds);
    const byId = new Map((products || []).map((p) => [p.product_id, p]));
    for (const c of coupons) {
      const p = byId.get(c.product_id);
      (c as Record<string, unknown>).product_name = p?.name || null;
      (c as Record<string, unknown>).product_url = p?.product_url || null;
      (c as Record<string, unknown>).product_image_url = p?.image_url || null;
      (c as Record<string, unknown>).product_price = p?.price || null;
      (c as Record<string, unknown>).product_sale_price = p?.sale_price || null;
    }
  }

  return NextResponse.json({ coupons });
}
