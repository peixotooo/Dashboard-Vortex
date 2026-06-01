import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { importMissingCartsFromVnda } from "@/lib/cart-recovery/vnda-import";

export const maxDuration = 60;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const body = await request.json().catch(() => ({}));
    const hours = Math.max(1, Math.min(168, Number(body.hours) || 48));

    const stats = await importMissingCartsFromVnda({
      admin: createAdminClient(),
      workspaceId,
      hours,
      maxPages: 5,
      perPage: 100,
      rateLimitMs: 150,
    });

    return NextResponse.json({
      ok: true,
      window_hours: hours,
      ...stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CartRecovery Import]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
