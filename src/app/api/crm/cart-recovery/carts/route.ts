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

// GET /api/crm/cart-recovery/carts?status=open&limit=50
// Lista carrinhos do workspace (filtrável por status) com contagem de
// mensagens enviadas. Usado pra dashboard de monitoramento na UI.
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const status = request.nextUrl.searchParams.get("status");
    const limit = Math.min(
      200,
      Number(request.nextUrl.searchParams.get("limit") || 50)
    );

    const admin = createAdminClient();

    let query = admin
      .from("abandoned_carts")
      .select(
        "id, vnda_cart_token, customer_email, customer_name, cart_total, status, abandoned_at, recovered_at, recovery_url, items"
      )
      .eq("workspace_id", workspaceId)
      .order("abandoned_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data: carts, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    // Counts agregados rápidos pra header do dashboard.
    const { data: counts } = await admin
      .from("abandoned_carts")
      .select("status")
      .eq("workspace_id", workspaceId);

    const summary = (counts || []).reduce(
      (acc: Record<string, number>, r) => {
        acc[r.status as string] = (acc[r.status as string] || 0) + 1;
        return acc;
      },
      {}
    );

    return NextResponse.json({ carts: carts || [], summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
