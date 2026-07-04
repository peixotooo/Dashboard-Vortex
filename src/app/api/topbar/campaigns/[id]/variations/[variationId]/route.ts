import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

type RouteCtx = { params: Promise<{ id: string; variationId: string }> };

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(request));
  } catch (error) {
    return handleAuthError(error);
  }

  const { id, variationId } = await ctx.params;
  const admin = createAdminClient();

  const { error } = await admin
    .from("topbar_variations")
    .delete()
    .eq("id", variationId)
    .eq("campaign_id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
