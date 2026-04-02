import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * GET — List hub orders with filters.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const page = parseInt(req.nextUrl.searchParams.get("page") || "0", 10);
  const syncStatus = req.nextUrl.searchParams.get("sync_status") || "";
  const search = req.nextUrl.searchParams.get("search") || "";
  const limit = 50;

  const supabase = createAdminClient();
  let query = supabase
    .from("hub_orders")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId);

  if (syncStatus && syncStatus !== "all") {
    query = query.eq("sync_status", syncStatus);
  }

  if (search) {
    query = query.or(
      `buyer_name.ilike.%${search}%,ml_order_id.eq.${isNaN(Number(search)) ? 0 : Number(search)},ecc_numero.ilike.%${search}%`
    );
  }

  query = query
    .order("ml_date", { ascending: false, nullsFirst: false })
    .range(page * limit, (page + 1) * limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    orders: data || [],
    total: count || 0,
  });
}
