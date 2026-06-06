import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

const ALLOWED = ["published", "pending", "hidden", "rejected"];

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const body = await request.json();
    if (body.status !== undefined && !ALLOWED.includes(body.status)) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("store_reviews")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ review: data });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const admin = createAdminClient();
    const { error } = await admin.from("store_reviews").delete().eq("id", id).eq("workspace_id", workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleAuthError(e);
  }
}
