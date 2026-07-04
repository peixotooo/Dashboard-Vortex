import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { listDeliverables } from "@/lib/agent/memory";

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

// GET /api/team/deliverables?agent_id=xxx&deliverable_type=copy&status=final
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const url = new URL(request.url);
    const filters = {
      agent_id: url.searchParams.get("agent_id") || undefined,
      deliverable_type:
        url.searchParams.get("deliverable_type") || undefined,
      status: url.searchParams.get("status") || undefined,
      task_id: url.searchParams.get("task_id") || undefined,
    };

    const deliverables = await listDeliverables(
      supabase,
      workspaceId,
      filters
    );
    return NextResponse.json({ deliverables });
  } catch (error) {
    return handleAuthError(error);
  }
}
