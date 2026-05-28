import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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

async function authorize(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("gift_requests")
    .select("status, created_at, read_at, converted_at, product_id")
    .eq("workspace_id", auth.workspaceId)
    .gte(
      "created_at",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const byProduct: Record<string, number> = {};
  let read = 0;
  let converted = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.read_at) read++;
    if (r.converted_at) converted++;
    if (r.product_id) byProduct[r.product_id] = (byProduct[r.product_id] || 0) + 1;
  }

  const topProducts = Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([product_id, count]) => ({ product_id, count }));

  return NextResponse.json({
    total,
    by_status: byStatus,
    read,
    read_rate: total ? read / total : 0,
    converted,
    conversion_rate: total ? converted / total : 0,
    top_products: topProducts,
  });
}
