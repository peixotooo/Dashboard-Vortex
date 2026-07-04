import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getCouponSettings, upsertCouponSettings } from "@/lib/coupons/settings";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const settings = await getCouponSettings(workspaceId);
    return NextResponse.json({ settings });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();
    try {
      const settings = await upsertCouponSettings(workspaceId, body);
      return NextResponse.json({ settings });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 400 });
    }
  } catch (error) {
    return handleAuthError(error);
  }
}
