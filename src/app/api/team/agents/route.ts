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
// ?slim=true — returns only agent info without stats (faster for chat sidebar, filters)
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

    // Seed team agents if they don't exist yet (fast count check, skips if synced)
    await seedTeamAgents(supabase, workspaceId);

    const slim = request.nextUrl.searchParams.get("slim") === "true";

    // Slim mode: return just agent list without stats (for chat sidebar, filters)
    if (slim) {
      const agents = await listAgents(supabase, workspaceId);
      return NextResponse.json({ agents });
    }

    // Full mode: parallel fetch of agents + stats
    const [agents, { data: taskCounts }, { data: deliverableCounts }] =
      await Promise.all([
        listAgents(supabase, workspaceId),
        supabase
          .from("agent_tasks")
          .select("agent_id, status, title")
          .eq("workspace_id", workspaceId),
        supabase
          .from("agent_deliverables")
          .select("agent_id")
          .eq("workspace_id", workspaceId),
      ]);

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

      // Find the active task title (priority: in_progress > todo > review)
      const inProgress = agentTasks.find((t) => t.status === "in_progress");
      const todo = agentTasks.find((t) => t.status === "todo");
      const review = agentTasks.find((t) => t.status === "review");
      const activeTask = inProgress || todo || review;

      return {
        ...agent,
        active_tasks: activeTasks,
        total_deliverables: deliverables,
        active_task_title: activeTask?.title || null,
      };
    });

    return NextResponse.json({ agents: agentsWithStats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
