import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/topbar/campaigns/[id]/variations?source=llm
 * Limpa em massa. Sem ?source, apaga todas. Com source=llm/human, filtra.
 */
export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(request));
  } catch (error) {
    return handleAuthError(error);
  }

  const { id } = await ctx.params;
  const source = new URL(request.url).searchParams.get("source");
  const admin = createAdminClient();

  let query = admin
    .from("topbar_variations")
    .delete()
    .eq("campaign_id", id)
    .eq("workspace_id", workspaceId);

  if (source === "llm" || source === "human") {
    query = query.eq("generated_by", source);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
