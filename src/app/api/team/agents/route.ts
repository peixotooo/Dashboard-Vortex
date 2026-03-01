import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { listAgents, seedTeamAgents } from "@/lib/agent/memory";

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

// GET /api/team/agents — list all agents (seeds on first use)
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

    // Seed team agents if they don't exist yet (idempotent)
    await seedTeamAgents(supabase, workspaceId);

    const agents = await listAgents(supabase, workspaceId);

    // Get task counts per agent
    const { data: taskCounts } = await supabase
      .from("agent_tasks")
      .select("agent_id, status")
      .eq("workspace_id", workspaceId);

    const { data: deliverableCounts } = await supabase
      .from("agent_deliverables")
      .select("agent_id")
      .eq("workspace_id", workspaceId);

    const agentsWithStats = agents.map((agent) => {
      const agentTasks = (taskCounts || []).filter(
        (t) => t.agent_id === agent.id
      );
      const activeTasks = agentTasks.filter(
        (t) => t.status !== "done"
      ).length;
      const deliverables = (deliverableCounts || []).filter(
        (d) => d.agent_id === agent.id
      ).length;

      return {
        ...agent,
        active_tasks: activeTasks,
        total_deliverables: deliverables,
      };
    });

    return NextResponse.json({ agents: agentsWithStats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
