import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { generateCampaignVariations } from "@/lib/topbar/generate";

type RouteCtx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: RouteCtx) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(request));
  } catch (error) {
    return handleAuthError(error);
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  try {
    const variations = await generateCampaignVariations({
      workspaceId,
      campaignId: id,
      count: body.count,
      model: body.model,
    });
    return NextResponse.json({ variations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
