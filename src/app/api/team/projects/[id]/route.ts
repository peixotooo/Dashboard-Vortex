import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateProject } from "@/lib/agent/memory";

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
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: project, error } = await supabase
      .from("agent_projects")
      .select("*, created_by_agent:agents!agent_projects_created_by_agent_id_fkey(*)")
      .eq("id", id)
      .single();

    if (error || !project)
      return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Also load tasks linked to this project
    const { data: tasks } = await supabase
      .from("agent_tasks")
      .select("*, agent:agents!agent_tasks_agent_id_fkey(id, name, slug, avatar_color)")
      .eq("project_id", id)
      .order("created_at", { ascending: true });

    return NextResponse.json({ project: { ...project, tasks: tasks || [] } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/team/projects/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const project = await updateProject(supabase, id, body);
    return NextResponse.json({ project });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/team/projects/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { error } = await supabase
      .from("agent_projects")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
