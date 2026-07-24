import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateTask, deleteTask, getTask } from "@/lib/agent/memory";
import {
  AuthError,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { readLimitedJson } from "@/lib/security/webhook-request";

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

// GET /api/team/tasks/[id] — task detail with deliverables + project + agents
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const supabase = createSupabase(request);

    const task = await getTask(supabase, id, workspaceId);
    if (!task)
      return NextResponse.json({ error: "Task not found" }, { status: 404 });

    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/tasks/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/team/tasks/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const supabase = createSupabase(request);

    const parsed = await readLimitedJson(request, 64 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as {
            status?: string;
            priority?: string;
            title?: string;
            description?: string;
            agent_id?: string;
            due_date?: string | null;
          })
        : {};
    const task = await updateTask(supabase, id, body, workspaceId);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/tasks/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/team/tasks/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const supabase = createSupabase(request);

    await deleteTask(supabase, id, workspaceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/tasks/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
