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
  return NextResponse.json({ coupons: data || [] });
}
