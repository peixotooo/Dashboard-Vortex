import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getConversationMessages } from "@/lib/agent/memory";
import {
  AuthError,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// GET /api/agent/conversations/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const messages = await getConversationMessages(
      supabase,
      id,
      50,
      workspaceId
    );
    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[agent/conversations/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
