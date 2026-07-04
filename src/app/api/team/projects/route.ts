import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
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
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;

    const projects = await listProjects(supabase, workspaceId, { status });
    return NextResponse.json({ projects });
  } catch (error) {
    return handleAuthError(error);
  }
}

// POST /api/team/projects
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const body = await request.json();
    const project = await createProject(supabase, workspaceId, body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleAuthError(error);
  }
}
