import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateProject } from "@/lib/agent/memory";
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

// GET /api/team/projects/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const supabase = createSupabase(request);

    const { data: project, error } = await supabase
      .from("agent_projects")
      .select("*, created_by_agent:agents!agent_projects_created_by_agent_id_fkey(*)")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !project)
      return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Also load tasks linked to this project
    const { data: tasks } = await supabase
      .from("agent_tasks")
      .select("*, agent:agents!agent_tasks_agent_id_fkey(id, name, slug, avatar_color)")
      .eq("project_id", id)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    return NextResponse.json({ project: { ...project, tasks: tasks || [] } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/projects/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/team/projects/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
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
            title?: string;
            description?: string;
          })
        : {};
    const project = await updateProject(supabase, id, body, workspaceId);
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/projects/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/team/projects/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const supabase = createSupabase(request);

    const { error } = await supabase
      .from("agent_projects")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[team/projects/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
