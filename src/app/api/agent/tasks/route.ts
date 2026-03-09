import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

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

// GET /api/agent/tasks?conversation_id=xxx&status=done&since=2026-03-09T00:00:00Z
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversation_id");
    const status = url.searchParams.get("status");
    const since = url.searchParams.get("since");

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("agent_tasks")
      .select("id, title, status, completed_at, agent:agents!agent_tasks_agent_id_fkey(name, slug)")
      .eq("conversation_id", conversationId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (status) {
      query = query.eq("status", status);
    }

    if (since) {
      query = query.gt("updated_at", since);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ tasks: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
