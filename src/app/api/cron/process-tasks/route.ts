import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { processTaskBatch } from "@/lib/agent/task-processor";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  console.log(
    "[cron/process-tasks] Cron triggered at",
    new Date().toISOString()
  );

  try {
    const supabase = createAdminClient();

    // Quick bail: skip entirely if no pending work exists (saves function time + DB queries)
    const { count } = await supabase
      .from("agent_tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["todo", "in_progress"]);

    if (!count || count === 0) {
      return Response.json({ success: true, skipped: "no pending tasks" });
    }

    const result = await processTaskBatch(supabase);

    const summary = {
      success: true,
      processed: result.processed.length,
      skipped: result.skipped,
      staleReset: result.staleReset,
      compiledProjects: result.compiledProjects,
      details: result.processed.map((r) => ({
        taskId: r.taskId,
        title: r.taskTitle,
        agent: r.agentSlug,
        status: r.status,
        error: r.error || null,
      })),
    };

    console.log("[cron/process-tasks] Response:", JSON.stringify(summary));

    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/process-tasks] Fatal error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
