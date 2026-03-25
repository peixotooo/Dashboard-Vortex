import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "0", 10);
  const pageSize = 50;
  const search = searchParams.get("search") || "";
  const source = searchParams.get("source") || "";
  const syncStatus = searchParams.get("sync_status") || "";
  const linkedOnly = searchParams.get("linked") === "true";
  const listingType = searchParams.get("listing_type") || "";

  const supabase = createAdminClient();

  // Order: parents first (ecc_pai_sku null), then children grouped by parent SKU
  let query = supabase
    .from("hub_products")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("ecc_pai_sku", { ascending: true, nullsFirst: true })
    .order("sku", { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (search) {
    query = query.or(`sku.ilike.%${search}%,nome.ilike.%${search}%`);
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (syncStatus) {
    query = query.eq("sync_status", syncStatus);
  }
  if (linkedOnly) {
    query = query.eq("linked", true);
  }
  if (listingType) {
    query = query.eq("ml_data->>listing_type_id", listingType);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    products: data || [],
    total: count ?? 0,
    page,
    pageSize,
    hasMore: (data?.length ?? 0) === pageSize,
  });
}

export async function DELETE(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const ids: string[] = body.ids || [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("hub_products")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length });
}
