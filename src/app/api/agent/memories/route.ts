import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { loadCoreMemories, deleteMemoryById, deleteAllMemories } from "@/lib/agent/memory";

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

// GET /api/agent/memories?account_id=xxx
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const accountId = new URL(request.url).searchParams.get("account_id") || "";
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    const memories = await loadCoreMemories(supabase, workspaceId, accountId);
    return NextResponse.json({ memories, count: memories.length });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agent/memories?id=xxx  OR  ?account_id=xxx&all=true
export async function DELETE(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const url = new URL(request.url);
    const memoryId = url.searchParams.get("id");
    const accountId = url.searchParams.get("account_id");
    const all = url.searchParams.get("all") === "true";

    if (all && accountId) {
      await deleteAllMemories(supabase, workspaceId, accountId);
      return NextResponse.json({ success: true, message: "All memories deleted" });
    }

    if (memoryId) {
      await deleteMemoryById(supabase, memoryId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Provide id or account_id+all=true" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
