import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTask } from "./memory";
import { getAgent, updateTask, loadProjectContext } from "./memory";
import { runSpecialist } from "./claude-client";
import type { AccountContext } from "./system-prompt";
import { decrypt } from "@/lib/encryption";
import { setContextToken } from "@/lib/meta-api";

// --- Types ---

interface TaskProcessingResult {
  taskId: string;
  taskTitle: string;
  agentSlug: string;
  status: "done" | "review" | "error";
  error?: string;
}

export interface ProcessBatchResult {
  processed: TaskProcessingResult[];
  skipped: number;
  staleReset: number;
}

// --- Constants ---

const MAX_TASKS_PER_RUN = 3;
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

// --- Main entry point ---

export async function processTaskBatch(
  supabase: SupabaseClient
): Promise<ProcessBatchResult> {
  const results: TaskProcessingResult[] = [];
  let skipped = 0;

  // 1. Reset stale "in_progress" tasks (stuck > 10 min)
  const staleReset = await resetStaleTasks(supabase);

  // 2. Fetch eligible tasks: status = "todo", agent_id IS NOT NULL
  const tasks = await fetchEligibleTasks(supabase);

  if (tasks.length === 0) {
    return { processed: [], skipped: 0, staleReset };
  }

  // 3. Process up to MAX_TASKS_PER_RUN tasks
  for (const task of tasks.slice(0, MAX_TASKS_PER_RUN)) {
    if (!task.agent_id) {
      skipped++;
      continue;
    }

    // Resolve the agent
    const agent = await getAgent(supabase, task.agent_id);
    if (!agent) {
      skipped++;
      continue;
    }

    // Resolve workspace context
    const wsContext = await resolveWorkspaceContext(supabase, task.workspace_id);
    if (!wsContext) {
      skipped++;
      continue;
    }

    // Claim the task
    try {
      await updateTask(supabase, task.id, { status: "in_progress" });
    } catch {
      skipped++;
      continue;
    }

    // Execute the specialist
    const result = await executeTask(supabase, task, agent.slug, wsContext);
    results.push(result);
  }

  return { processed: results, skipped, staleReset };
}

// --- Helpers ---

async function fetchEligibleTasks(
  supabase: SupabaseClient
): Promise<AgentTask[]> {
  const { data } = await supabase
    .from("agent_tasks")
    .select("*")
    .eq("status", "todo")
    .not("agent_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (!data) return [];

  // Sort by priority: urgent > high > medium > low
  return data.sort((a: AgentTask, b: AgentTask) => {
    const aIdx = PRIORITY_ORDER.indexOf(a.priority);
    const bIdx = PRIORITY_ORDER.indexOf(b.priority);
    return aIdx - bIdx;
  });
}

async function resetStaleTasks(supabase: SupabaseClient): Promise<number> {
  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_MS
  ).toISOString();

  const { data } = await supabase
    .from("agent_tasks")
    .select("id")
    .eq("status", "in_progress")
    .lt("updated_at", staleThreshold);

  if (!data || data.length === 0) return 0;

  for (const task of data) {
    await supabase
      .from("agent_tasks")
      .update({ status: "todo", updated_at: new Date().toISOString() })
      .eq("id", task.id);
  }

  return data.length;
}

// --- Workspace context resolution ---

interface WorkspaceContext {
  accountId: string;
  accountContext: AccountContext;
  projectContext?: string;
}

async function resolveWorkspaceContext(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceContext | null> {
  // Get default Meta account for this workspace
  const { data: account } = await supabase
    .from("meta_accounts")
    .select("account_id, account_name")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  let accountId = "none";
  let accountName = "Sem conta Meta";

  if (account) {
    accountId = account.account_id;
    accountName = account.account_name;
  } else {
    // Try any account
    const { data: anyAccount } = await supabase
      .from("meta_accounts")
      .select("account_id, account_name")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();

    if (anyAccount) {
      accountId = anyAccount.account_id;
      accountName = anyAccount.account_name;
    }
  }

  // Set Meta API token if available (for paid-ads specialist)
  const { data: connection } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connection?.access_token) {
    try {
      setContextToken(decrypt(connection.access_token));
    } catch {
      // Continue without Meta API access
    }
  }

  // Load project context
  const projectContext = await loadProjectContext(supabase, workspaceId);

  return {
    accountId,
    accountContext: {
      account_name: accountName,
      account_id: accountId,
      currency: "BRL",
      timezone: "America/Sao_Paulo",
    },
    projectContext: projectContext || undefined,
  };
}

// --- Task execution ---

function buildTaskPrompt(task: AgentTask): string {
  return [
    `## Tarefa: ${task.title}`,
    "",
    task.description || "(sem descricao detalhada)",
    "",
    `- Tipo: ${task.task_type}`,
    `- Prioridade: ${task.priority}`,
    `- Task ID: ${task.id}`,
    "",
    "## Instrucoes Importantes",
    "1. Execute a tarefa descrita acima com qualidade profissional.",
    "2. Ao finalizar, OBRIGATORIAMENTE salve o resultado usando a ferramenta **save_deliverable**.",
    `3. No save_deliverable, use task_id: "${task.id}" para vincular a entrega a esta tarefa.`,
    "4. Escolha o deliverable_type adequado (copy, calendar, audit, strategy, report, email_sequence, general).",
    "5. Se a tarefa pedir multiplas entregas, salve cada uma separadamente.",
  ].join("\n");
}

async function executeTask(
  supabase: SupabaseClient,
  task: AgentTask,
  agentSlug: string,
  wsContext: WorkspaceContext
): Promise<TaskProcessingResult> {
  const taskPrompt = buildTaskPrompt(task);

  try {
    const result = await runSpecialist({
      agentSlug,
      task: taskPrompt,
      context:
        "Tarefa executada automaticamente pelo sistema. Salve o resultado com save_deliverable.",
      complexity: task.priority === "urgent" ? "deep" : "normal",
      accountId: wsContext.accountId,
      accountContext: wsContext.accountContext,
      workspaceId: task.workspace_id,
      supabase,
      projectContext: wsContext.projectContext,
    });

    // Short responses suggest incomplete work
    const finalStatus = result.text.length < 50 ? "review" : "done";
    await updateTask(supabase, task.id, { status: finalStatus });

    return {
      taskId: task.id,
      taskTitle: task.title,
      agentSlug,
      status: finalStatus as "done" | "review",
    };
  } catch (err) {
    // Revert to "todo" for retry
    try {
      await updateTask(supabase, task.id, { status: "todo" });
    } catch {
      // Stale reset will catch it
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      agentSlug,
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
