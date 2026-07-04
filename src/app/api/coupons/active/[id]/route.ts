import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { approveCoupon, rejectCoupon, pauseActiveCoupon } from "@/lib/coupons/orchestrator";

// POST /api/coupons/active/[id]  body { action: 'approve'|'reject'|'pause', reason? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json();
    const action = body?.action;

    if (action === "approve") {
      const r = await approveCoupon(workspaceId, id, userId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (action === "reject") {
      const r = await rejectCoupon(workspaceId, id, userId, body?.reason);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (action === "pause") {
      const r = await pauseActiveCoupon(workspaceId, id, userId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action invalido (use approve|reject|pause)" }, { status: 400 });
  } catch (error) {
    return handleAuthError(error);
  }
}
