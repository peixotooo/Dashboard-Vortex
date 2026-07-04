import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const page = parseInt(
      request.nextUrl.searchParams.get("page") || "1",
      10
    );
    const limit = parseInt(
      request.nextUrl.searchParams.get("limit") || "20",
      10
    );
    const offset = (page - 1) * limit;

    const admin = createAdminClient();
    const { data, count, error } = await admin
      .from("wapi_group_dispatches")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      limit,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
