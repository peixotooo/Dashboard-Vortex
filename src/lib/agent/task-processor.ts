import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTask } from "./memory";
import {
  getAgent,
  getAgentBySlug,
  updateTask,
  loadProjectContext,
} from "./memory";
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

const TASK_TYPE_DEFAULT_AGENT: Record<string, string> = {
  copy: "copywriting",
  seo: "seo-audit",
  social_calendar: "social-content",
  campaign: "paid-ads",
  cro: "page-cro",
  strategy: "launch-strategy",
  revenue: "churn-prevention",
  general: "coordenador",
};

// --- Main entry point ---

export async function processTaskBatch(
  supabase: SupabaseClient
): Promise<ProcessBatchResult> {
  const results: TaskProcessingResult[] = [];
  let skipped = 0;

  console.log("[cron/process-tasks] Starting batch processing...");

  // 1. Reset stale "in_progress" tasks (stuck > 10 min)
  const staleReset = await resetStaleTasks(supabase);
  if (staleReset > 0) {
    console.log(
      `[cron/process-tasks] Reset ${staleReset} stale tasks back to todo`
    );
  }

  // 2. Fetch eligible tasks (auto-assigns orphans)
  const tasks = await fetchEligibleTasks(supabase);
  console.log(`[cron/process-tasks] Found ${tasks.length} eligible tasks`);

  if (tasks.length === 0) {
    console.log("[cron/process-tasks] No eligible tasks. Done.");
    return { processed: [], skipped: 0, staleReset };
  }

  // 3. Process up to MAX_TASKS_PER_RUN tasks
  for (const task of tasks.slice(0, MAX_TASKS_PER_RUN)) {
    // Resolve the agent
    const agent = await getAgent(supabase, task.agent_id!);
    if (!agent) {
      console.log(
        `[cron/process-tasks] Skipping "${task.title}": agent not found (${task.agent_id})`
      );
      skipped++;
      continue;
    }

    // Resolve workspace context
    const wsContext = await resolveWorkspaceContext(
      supabase,
      task.workspace_id
    );
    if (!wsContext) {
      console.log(
        `[cron/process-tasks] Skipping "${task.title}": workspace context failed`
      );
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

    console.log(
      `[cron/process-tasks] Executing: "${task.title}" (${task.task_type}, ${task.priority}) → ${agent.slug}`
    );

    // Execute the specialist
    const result = await executeTask(supabase, task, agent.slug, wsContext);
    results.push(result);

    console.log(
      `[cron/process-tasks] Result: "${task.title}" → ${result.status}${result.error ? ` (${result.error})` : ""}`
    );
  }

  console.log(
    `[cron/process-tasks] Batch complete: processed=${results.length}, skipped=${skipped}, staleReset=${staleReset}`
  );

  return { processed: results, skipped, staleReset };
}

// --- Helpers ---

async function fetchEligibleTasks(
  supabase: SupabaseClient
): Promise<AgentTask[]> {
  // Fetch ALL "todo" tasks — including unassigned ones
  const { data } = await supabase
    .from("agent_tasks")
    .select("*")
    .eq("status", "todo")
    .order("created_at", { ascending: true })
    .limit(20);

  if (!data) return [];

  // Auto-assign tasks that have no agent_id
  for (const task of data) {
    if (!task.agent_id && task.task_type) {
      const defaultSlug =
        TASK_TYPE_DEFAULT_AGENT[task.task_type] ||
        TASK_TYPE_DEFAULT_AGENT.general;
      const agent = await getAgentBySlug(
        supabase,
        task.workspace_id,
        defaultSlug
      );
      if (agent) {
        await supabase
          .from("agent_tasks")
          .update({ agent_id: agent.id, updated_at: new Date().toISOString() })
          .eq("id", task.id);
        task.agent_id = agent.id;
        console.log(
          `[cron/process-tasks] Auto-assigned "${task.title}" (${task.task_type}) → ${defaultSlug}`
        );
      }
    }
  }

  // Filter out any tasks that still have no agent and sort by priority
  return data
    .filter((t: AgentTask) => t.agent_id !== null)
    .sort((a: AgentTask, b: AgentTask) => {
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
    `## Tarefa Atribuida: ${task.title}`,
    "",
    task.description || "(sem descricao detalhada)",
    "",
    `- Tipo: ${task.task_type}`,
    `- Prioridade: ${task.priority}`,
    `- Task ID: ${task.id}`,
    "",
    "## INSTRUCOES OBRIGATORIAS",
    "",
    "### 1. Execute com qualidade profissional",
    "Produza uma entrega completa e detalhada, como um especialista senior faria.",
    "NAO produza resumos, esbocos ou rascunhos — entregue o trabalho FINAL.",
    "",
    "### 2. SALVE O RESULTADO usando save_deliverable",
    "Voce DEVE chamar a ferramenta **save_deliverable** ao menos uma vez.",
    "Se nao chamar save_deliverable, o trabalho sera PERDIDO.",
    `- Use task_id: "${task.id}" para vincular a entrega a esta tarefa.`,
    "- Escolha o deliverable_type adequado: copy, calendar, audit, strategy, report, email_sequence ou general.",
    "- Use formato markdown para textos e json para dados estruturados (ex: calendarios).",
    "",
    "### 3. Multiplas entregas",
    "Se a tarefa pedir varias entregas, salve CADA UMA separadamente via save_deliverable.",
    "",
    "### 4. Nao peca confirmacao",
    "Voce esta executando de forma automatica via cron. Nao ha usuario interativo.",
    "Execute diretamente sem pedir confirmacao ou fazer perguntas.",
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
        "Tarefa executada automaticamente pelo sistema. Salve o resultado com save_deliverable. NAO peca confirmacao.",
      complexity: task.priority === "urgent" ? "deep" : "normal",
      accountId: wsContext.accountId,
      accountContext: wsContext.accountContext,
      workspaceId: task.workspace_id,
      supabase,
      projectContext: wsContext.projectContext,
      maxLoops: 10,
      maxTokens: 8192,
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
