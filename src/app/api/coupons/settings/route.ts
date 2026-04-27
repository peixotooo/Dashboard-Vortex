import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getCouponSettings, upsertCouponSettings } from "@/lib/coupons/settings";

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

export async function GET(request: NextRequest) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  const settings = await getCouponSettings(workspaceId);
  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  const body = await request.json();
  try {
    const settings = await upsertCouponSettings(workspaceId, body);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 400 });
  }
}
