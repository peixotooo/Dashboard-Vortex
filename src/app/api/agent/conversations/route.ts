import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
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
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const url = new URL(request.url);
    const accountId = url.searchParams.get("account_id") || "";
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    const limit = parseInt(url.searchParams.get("limit") || "20");
    const agentId = url.searchParams.get("agent_id") || undefined;

    const conversations = await listConversations(supabase, workspaceId, accountId, limit, agentId);
    return NextResponse.json({ conversations });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
