import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { CompletionRequiredError } from "./db";

// Shared helpers used by every Mission Control API route.
// Keeps auth + workspace scoping uniform so no route accidentally leaks data.

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

export type RouteContext = {
  supabase: ReturnType<typeof createSupabase>;
  workspaceId: string;
  userId: string;
  actor: string;
};

export async function requireWorkspace(
  request: NextRequest
): Promise<RouteContext | NextResponse> {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json(
      { error: "Workspace not specified" },
      { status: 400 }
    );
  }
  return {
    supabase,
    workspaceId,
    userId: user.id,
    actor: user.email ?? user.id,
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof CompletionRequiredError) {
    return NextResponse.json(
      { error: err.message, missing: err.missing, code: "completion_required" },
      { status: 422 }
    );
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
