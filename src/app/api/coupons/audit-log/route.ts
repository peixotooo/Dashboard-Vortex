import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const planId = searchParams.get("plan_id");

    const admin = createAdminClient();
    let q = admin
      .from("coupon_audit_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (action) q = q.eq("action", action);
    if (planId) q = q.eq("plan_id", planId);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entries: data || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}
