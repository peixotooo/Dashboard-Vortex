import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { processTaskBatch } from "@/lib/agent/task-processor";

export const maxDuration = 60;

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

  try {
    const supabase = createAdminClient();
    const result = await processTaskBatch(supabase);

    return Response.json({
      success: true,
      processed: result.processed.length,
      skipped: result.skipped,
      staleReset: result.staleReset,
      details: result.processed.map((r) => ({
        taskId: r.taskId,
        title: r.taskTitle,
        agent: r.agentSlug,
        status: r.status,
        error: r.error || null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/process-tasks] Fatal error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
