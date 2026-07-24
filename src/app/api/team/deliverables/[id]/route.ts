import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getDeliverable } from "@/lib/agent/memory";
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

// GET /api/team/deliverables/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: "Deliverable not found" },
        { status: 404 }
      );
    }
    const supabase = createSupabase(request);

    const deliverable = await getDeliverable(supabase, id, workspaceId);
    if (!deliverable)
      return NextResponse.json(
        { error: "Deliverable not found" },
        { status: 404 }
      );

    return NextResponse.json({ deliverable });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/deliverables/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
