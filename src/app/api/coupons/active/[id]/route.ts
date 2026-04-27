import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { approveCoupon, rejectCoupon, pauseActiveCoupon } from "@/lib/coupons/orchestrator";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

// POST /api/coupons/active/[id]  body { action: 'approve'|'reject'|'pause', reason? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

  const { id } = await params;
  const body = await request.json();
  const action = body?.action;

  if (action === "approve") {
    const r = await approveCoupon(workspaceId, id, user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (action === "reject") {
    const r = await rejectCoupon(workspaceId, id, user.id, body?.reason);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (action === "pause") {
    const r = await pauseActiveCoupon(workspaceId, id, user.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "action invalido (use approve|reject|pause)" }, { status: 400 });
}
