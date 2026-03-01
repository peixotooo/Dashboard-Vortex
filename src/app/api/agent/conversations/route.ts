import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { listConversations } from "@/lib/agent/memory";

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

// GET /api/agent/conversations?account_id=xxx&limit=20&offset=0
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const url = new URL(request.url);
    const accountId = url.searchParams.get("account_id") || "";
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    const limit = parseInt(url.searchParams.get("limit") || "20");

    const conversations = await listConversations(supabase, workspaceId, accountId, limit);
    return NextResponse.json({ conversations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
