import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReviewSettings, upsertReviewSettings } from "@/lib/reviews/settings";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const settings = await getReviewSettings(workspaceId);
    return NextResponse.json({ settings });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();
    const settings = await upsertReviewSettings(workspaceId, body);
    return NextResponse.json({ settings });
  } catch (e) {
    return handleAuthError(e);
  }
}
