import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { listTasks, createTask } from "@/lib/agent/memory";

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

// GET /api/team/tasks?status=todo&agent_id=xxx&task_type=copy
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      agent_id: url.searchParams.get("agent_id") || undefined,
      task_type: url.searchParams.get("task_type") || undefined,
      priority: url.searchParams.get("priority") || undefined,
      project_id: url.searchParams.get("project_id") || undefined,
    };

    const tasks = await listTasks(supabase, workspaceId, filters);
    return NextResponse.json({ tasks });
  } catch (error) {
    return handleAuthError(error);
  }
}

// POST /api/team/tasks — create a task
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const body = await request.json();
    const task = await createTask(supabase, workspaceId, body);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleAuthError(error);
  }
}
