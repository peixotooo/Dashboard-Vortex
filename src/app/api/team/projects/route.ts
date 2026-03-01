import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { listProjects, createProject } from "@/lib/agent/memory";

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

// GET /api/team/projects?status=planning
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;

    const projects = await listProjects(supabase, workspaceId, { status });
    return NextResponse.json({ projects });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/team/projects
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const body = await request.json();
    const project = await createProject(supabase, workspaceId, body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
