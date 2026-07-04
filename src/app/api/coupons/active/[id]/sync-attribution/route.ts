import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { syncAttributionForCoupon } from "@/lib/coupons/attribution";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const r = await syncAttributionForCoupon(workspaceId, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, attributed_revenue: r.revenue, attributed_units: r.units });
  } catch (error) {
    return handleAuthError(error);
  }
}
