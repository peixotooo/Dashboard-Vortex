import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * GET — List hub logs with filters.
 */
export async function GET(req: NextRequest) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(req));
  } catch (error) {
    return handleAuthError(error);
  }

  const page = parseInt(req.nextUrl.searchParams.get("page") || "0", 10);
  const action = req.nextUrl.searchParams.get("action") || "";
  const status = req.nextUrl.searchParams.get("status") || "";
  const entity = req.nextUrl.searchParams.get("entity") || "";
  const entityId = req.nextUrl.searchParams.get("entity_id") || "";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100", 10);

  const supabase = createAdminClient();
  let query = supabase
    .from("hub_logs")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId);

  if (action && action !== "all") {
    query = query.eq("action", action);
  }
  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (entity && entity !== "all") {
    query = query.eq("entity", entity);
  }
  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    logs: data || [],
    total: count || 0,
  });
}
