import { SupabaseClient } from "@supabase/supabase-js";

// --- Types ---

export interface CoreMemory {
  id: string;
  workspace_id: string;
  account_id: string;
  category: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  account_id: string;
  user_id: string;
  agent_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// --- Core Memory ---

export async function loadCoreMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string
): Promise<CoreMemory[]> {
  const { data, error } = await supabase
    .from("agent_core_memory")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .order("category")
    .order("key");

  if (error) throw new Error(`Failed to load memories: ${error.message}`);
  return data || [];
}

export async function saveMemoryRecord(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  category: string,
  key: string,
  value: string
): Promise<CoreMemory> {
  const { data, error } = await supabase
    .from("agent_core_memory")
    .upsert(
      {
        workspace_id: workspaceId,
        account_id: accountId,
        category,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,account_id,category,key" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to save memory: ${error.message}`);
  return data;
}

export async function deleteMemoryRecord(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  category: string,
  key: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_core_memory")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .eq("category", category)
    .eq("key", key);

  if (error) throw new Error(`Failed to delete memory: ${error.message}`);
}

export async function searchMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  query: string
): Promise<CoreMemory[]> {
  const pattern = `%${query}%`;
  const { data, error } = await supabase
    .from("agent_core_memory")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .or(`key.ilike.${pattern},value.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`Failed to search memories: ${error.message}`);
  return data || [];
}

// --- Conversations ---

export async function createConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  userId: string,
  title?: string,
  agentId?: string
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({
      workspace_id: workspaceId,
      account_id: accountId,
      user_id: userId,
      title: title || null,
      agent_id: agentId || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data;
}

export async function listConversations(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string,
  limit = 20,
  agentId?: string
): Promise<Conversation[]> {
  let query = supabase
    .from("agent_conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (agentId) {
    query = query.eq("agent_id", agentId);
  }

  const { data, error } = await query;

  if (error)
    throw new Error(`Failed to list conversations: ${error.message}`);
  return data || [];
}

export async function updateConversationTimestamp(
  supabase: SupabaseClient,
  conversationId: string
): Promise<void> {
  await supabase
    .from("agent_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

// --- Messages ---

export async function saveMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>
): Promise<ConversationMessage> {
  const { data, error } = await supabase
    .from("agent_messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save message: ${error.message}`);
  return data;
}

export async function getConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 50
): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return data || [];
}

// --- Agent Documents ---

export type DocType = "soul" | "agent_rules" | "user_profile" | "daily_summary" | "project_context";

export interface AgentDocument {
  id: string;
  workspace_id: string;
  account_id: string | null;
  doc_type: DocType;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function loadDocument(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string | null,
  docType: "soul" | "agent_rules" | "user_profile"
): Promise<AgentDocument | null> {
  // Try account-specific first
  if (accountId) {
    const { data } = await supabase
      .from("agent_documents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("account_id", accountId)
      .eq("doc_type", docType)
      .single();
    if (data) return data;
  }

  // Fallback to workspace-global
  const { data } = await supabase
    .from("agent_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("account_id", null)
    .eq("doc_type", docType)
    .single();

  return data || null;
}

export async function upsertDocument(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string | null,
  docType: DocType,
  content: string
): Promise<AgentDocument> {
  // Check if document exists
  const existing = accountId
    ? await supabase
        .from("agent_documents")
        .select("id, version")
        .eq("workspace_id", workspaceId)
        .eq("account_id", accountId)
        .eq("doc_type", docType)
        .single()
    : await supabase
        .from("agent_documents")
        .select("id, version")
        .eq("workspace_id", workspaceId)
        .is("account_id", null)
        .eq("doc_type", docType)
        .single();

  if (existing.data) {
    // Update existing
    const { data, error } = await supabase
      .from("agent_documents")
      .update({
        content,
        version: existing.data.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.data.id)
      .select()
      .single();
    if (error) throw new Error(`Failed to update document: ${error.message}`);
    return data;
  }

  // Insert new
  const { data, error } = await supabase
    .from("agent_documents")
    .insert({
      workspace_id: workspaceId,
      account_id: accountId,
      doc_type: docType,
      content,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create document: ${error.message}`);
  return data;
}

export async function seedDefaultDocuments(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<void> {
  // Lazy import to avoid circular deps
  const { DEFAULT_SOUL, DEFAULT_AGENT_RULES } = await import(
    "./default-documents"
  );

  // Check if soul already exists (workspace-global)
  const { data: existingSoul } = await supabase
    .from("agent_documents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("account_id", null)
    .eq("doc_type", "soul")
    .single();

  if (!existingSoul) {
    await supabase.from("agent_documents").insert({
      workspace_id: workspaceId,
      account_id: null,
      doc_type: "soul",
      content: DEFAULT_SOUL,
    });
  }

  // Check if agent_rules already exists
  const { data: existingRules } = await supabase
    .from("agent_documents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("account_id", null)
    .eq("doc_type", "agent_rules")
    .single();

  if (!existingRules) {
    await supabase.from("agent_documents").insert({
      workspace_id: workspaceId,
      account_id: null,
      doc_type: "agent_rules",
      content: DEFAULT_AGENT_RULES,
    });
  }
}

// --- Bulk memory operations ---

export async function updateMemoryValue(
  supabase: SupabaseClient,
  memoryId: string,
  value: string
): Promise<CoreMemory> {
  const { data, error } = await supabase
    .from("agent_core_memory")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("id", memoryId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update memory: ${error.message}`);
  return data;
}

export async function deleteMemoryById(
  supabase: SupabaseClient,
  memoryId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_core_memory")
    .delete()
    .eq("id", memoryId);

  if (error) throw new Error(`Failed to delete memory: ${error.message}`);
}

export async function deleteAllMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  accountId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_core_memory")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId);

  if (error) throw new Error(`Failed to delete all memories: ${error.message}`);
}

// --- Team Agents ---

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  avatar_color: string;
  model_preference: string;
  is_default: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function seedTeamAgents(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<void> {
  const { TEAM_AGENTS } = await import("./team-agents");

  // Quick check: if agent count matches expected, skip full sync
  // This avoids ~100 queries on every page load (only runs on first load or deploy changes)
  const { count } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (count === TEAM_AGENTS.length) {
    return;
  }

  // Full sync needed — fetch existing agents
  const { data: existing } = await supabase
    .from("agents")
    .select("id, slug, name")
    .eq("workspace_id", workspaceId);

  const existingSlugs = new Set((existing || []).map((a: { slug: string }) => a.slug));
  const validSlugs = new Set(TEAM_AGENTS.map((a) => a.slug));

  // Remove agents that no longer exist in code (e.g., old generalist agents)
  const staleAgents = (existing || []).filter(
    (a: { id: string; slug: string }) => !validSlugs.has(a.slug)
  );
  for (const stale of staleAgents) {
    // Delete agent documents first (soul, rules)
    await supabase
      .from("agent_documents")
      .delete()
      .eq("agent_id", stale.id);
    // Delete the agent
    await supabase
      .from("agents")
      .delete()
      .eq("id", stale.id);
  }

  // Update existing agents (name, description, avatar_color, soul, rules)
  for (const agentDef of TEAM_AGENTS) {
    if (!existingSlugs.has(agentDef.slug)) continue;

    const existingAgent = (existing || []).find(
      (a: { slug: string }) => a.slug === agentDef.slug
    ) as { id: string; slug: string } | undefined;

    await supabase
      .from("agents")
      .update({
        name: agentDef.name,
        description: agentDef.description,
        avatar_color: agentDef.avatar_color,
        is_default: agentDef.is_default,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("slug", agentDef.slug);

    // Sync soul and rules documents to ensure latest instructions
    if (existingAgent) {
      for (const docType of ["soul", "agent_rules"] as const) {
        const content = docType === "soul" ? agentDef.soul : agentDef.rules;
        // Check if document exists
        const { data: doc } = await supabase
          .from("agent_documents")
          .select("id")
          .eq("agent_id", existingAgent.id)
          .eq("doc_type", docType)
          .single();

        if (doc) {
          await supabase
            .from("agent_documents")
            .update({ content })
            .eq("id", doc.id);
        } else {
          await supabase.from("agent_documents").insert({
            workspace_id: workspaceId,
            account_id: null,
            agent_id: existingAgent.id,
            doc_type: docType,
            content,
          });
        }
      }
    }
  }

  // Insert new agents that don't exist yet
  for (const agentDef of TEAM_AGENTS) {
    if (existingSlugs.has(agentDef.slug)) continue;

    // Create the agent
    const { data: agent, error } = await supabase
      .from("agents")
      .insert({
        workspace_id: workspaceId,
        name: agentDef.name,
        slug: agentDef.slug,
        description: agentDef.description,
        avatar_color: agentDef.avatar_color,
        model_preference: agentDef.model_preference,
        is_default: agentDef.is_default,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !agent) continue;

    // Seed soul document
    await supabase.from("agent_documents").insert({
      workspace_id: workspaceId,
      account_id: null,
      agent_id: agent.id,
      doc_type: "soul",
      content: agentDef.soul,
    });

    // Seed rules document
    await supabase.from("agent_documents").insert({
      workspace_id: workspaceId,
      account_id: null,
      agent_id: agent.id,
      doc_type: "agent_rules",
      content: agentDef.rules,
    });
  }
}

export async function listAgents(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("name");

  if (error) throw new Error(`Failed to list agents: ${error.message}`);
  return data || [];
}

export async function getAgent(
  supabase: SupabaseClient,
  agentId: string
): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (error) return null;
  return data;
}

export async function getAgentBySlug(
  supabase: SupabaseClient,
  workspaceId: string,
  slug: string
): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .single();

  if (error) return null;
  return data;
}

export async function loadAgentDocument(
  supabase: SupabaseClient,
  workspaceId: string,
  agentId: string,
  docType: "soul" | "agent_rules"
): Promise<AgentDocument | null> {
  const { data } = await supabase
    .from("agent_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("doc_type", docType)
    .single();

  return data || null;
}

export async function upsertAgentDocument(
  supabase: SupabaseClient,
  workspaceId: string,
  agentId: string,
  docType: "soul" | "agent_rules",
  content: string
): Promise<AgentDocument> {
  const { data: existing } = await supabase
    .from("agent_documents")
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("doc_type", docType)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from("agent_documents")
      .update({
        content,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(`Failed to update agent document: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from("agent_documents")
    .insert({
      workspace_id: workspaceId,
      account_id: null,
      agent_id: agentId,
      doc_type: docType,
      content,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create agent document: ${error.message}`);
  return data;
}

// --- Project Context (shared across all agents) ---

export async function loadProjectContext(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("agent_documents")
    .select("content")
    .eq("workspace_id", workspaceId)
    .is("account_id", null)
    .is("agent_id", null)
    .eq("doc_type", "project_context")
    .single();

  return data?.content || null;
}

// --- Projects ---

export interface AgentProject {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: string;
  created_by_agent_id: string | null;
  conversation_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createProject(
  supabase: SupabaseClient,
  workspaceId: string,
  params: {
    title: string;
    description?: string;
    created_by_agent_id?: string;
    conversation_id?: string;
  }
): Promise<AgentProject> {
  const { data, error } = await supabase
    .from("agent_projects")
    .insert({
      workspace_id: workspaceId,
      title: params.title,
      description: params.description || "",
      created_by_agent_id: params.created_by_agent_id || null,
      conversation_id: params.conversation_id || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create project: ${error.message}`);
  return data;
}

export async function listProjects(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: { status?: string }
): Promise<AgentProject[]> {
  let query = supabase
    .from("agent_projects")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list projects: ${error.message}`);
  return data || [];
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  updates: { status?: string; title?: string; description?: string }
): Promise<AgentProject> {
  const updateData: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (updates.status === "done") {
    updateData.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("agent_projects")
    .update(updateData)
    .eq("id", projectId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update project: ${error.message}`);
  return data;
}

// --- Tasks (Kanban) ---

export interface AgentTask {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  created_by_agent_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  task_type: string;
  due_date: string | null;
  completed_at: string | null;
  conversation_id: string | null;
  project_id: string | null;
  retry_count: number;
  last_processed_at: string | null;
  created_at: string;
  updated_at: string;
  agent?: Agent;
  project?: AgentProject;
}

export async function createTask(
  supabase: SupabaseClient,
  workspaceId: string,
  params: {
    title: string;
    description?: string;
    agent_id?: string;
    created_by_agent_id?: string;
    priority?: string;
    task_type?: string;
    due_date?: string;
    conversation_id?: string;
    project_id?: string;
  }
): Promise<AgentTask> {
  const { data, error } = await supabase
    .from("agent_tasks")
    .insert({
      workspace_id: workspaceId,
      title: params.title,
      description: params.description || "",
      agent_id: params.agent_id || null,
      created_by_agent_id: params.created_by_agent_id || null,
      priority: params.priority || "medium",
      task_type: params.task_type || "general",
      due_date: params.due_date || null,
      conversation_id: params.conversation_id || null,
      project_id: params.project_id || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create task: ${error.message}`);
  return data;
}

export async function updateTask(
  supabase: SupabaseClient,
  taskId: string,
  updates: {
    status?: string;
    priority?: string;
    title?: string;
    description?: string;
    agent_id?: string;
    due_date?: string | null;
  }
): Promise<AgentTask> {
  const updateData: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  // If moving to done, set completed_at
  if (updates.status === "done") {
    updateData.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("agent_tasks")
    .update(updateData)
    .eq("id", taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);
  return data;
}

export async function listTasks(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: {
    status?: string;
    agent_id?: string;
    task_type?: string;
    priority?: string;
    project_id?: string;
  }
): Promise<AgentTask[]> {
  let query = supabase
    .from("agent_tasks")
    .select(
      "*, agent:agents!agent_tasks_agent_id_fkey(*), project:agent_projects!agent_tasks_project_id_fkey(id, title, status)"
    )
    .eq("workspace_id", workspaceId);

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.agent_id) query = query.eq("agent_id", filters.agent_id);
  if (filters?.task_type) query = query.eq("task_type", filters.task_type);
  if (filters?.priority) query = query.eq("priority", filters.priority);
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list tasks: ${error.message}`);
  return data || [];
}

export async function getTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<
  | (AgentTask & {
      deliverables: AgentDeliverable[];
      created_by_agent: Agent | null;
    })
  | null
> {
  const { data: task, error } = await supabase
    .from("agent_tasks")
    .select(
      "*, agent:agents!agent_tasks_agent_id_fkey(*), created_by_agent:agents!agent_tasks_created_by_agent_id_fkey(*), project:agent_projects!agent_tasks_project_id_fkey(*)"
    )
    .eq("id", taskId)
    .single();

  if (error || !task) return null;

  const { data: deliverables } = await supabase
    .from("agent_deliverables")
    .select("*, agent:agents!agent_deliverables_agent_id_fkey(*)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  return {
    ...task,
    deliverables: deliverables || [],
    created_by_agent: task.created_by_agent || null,
  };
}

export async function deleteTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_tasks")
    .delete()
    .eq("id", taskId);

  if (error) throw new Error(`Failed to delete task: ${error.message}`);
}

// --- Deliverables ---

export interface AgentDeliverable {
  id: string;
  workspace_id: string;
  task_id: string | null;
  agent_id: string | null;
  project_id: string | null;
  title: string;
  content: string;
  deliverable_type: string;
  format: string;
  metadata: Record<string, unknown>;
  status: string;
  conversation_id: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  agent?: Agent;
}

export async function createDeliverable(
  supabase: SupabaseClient,
  workspaceId: string,
  params: {
    title: string;
    content: string;
    deliverable_type?: string;
    format?: string;
    metadata?: Record<string, unknown>;
    task_id?: string;
    agent_id?: string;
    conversation_id?: string;
    project_id?: string;
  }
): Promise<AgentDeliverable> {
  const { data, error } = await supabase
    .from("agent_deliverables")
    .insert({
      workspace_id: workspaceId,
      title: params.title,
      content: params.content,
      deliverable_type: params.deliverable_type || "general",
      format: params.format || "markdown",
      metadata: params.metadata || {},
      task_id: params.task_id || null,
      agent_id: params.agent_id || null,
      conversation_id: params.conversation_id || null,
      project_id: params.project_id || null,
      status: "final",
      delivered_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create deliverable: ${error.message}`);
  return data;
}

export async function listDeliverables(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: {
    agent_id?: string;
    deliverable_type?: string;
    status?: string;
    task_id?: string;
  }
): Promise<AgentDeliverable[]> {
  let query = supabase
    .from("agent_deliverables")
    .select("*, agent:agents!agent_deliverables_agent_id_fkey(id, name, slug, avatar_color), task:agent_tasks!agent_deliverables_task_id_fkey(id, title), project:agent_projects!agent_deliverables_project_id_fkey(id, title, status)")
    .eq("workspace_id", workspaceId);

  if (filters?.agent_id) query = query.eq("agent_id", filters.agent_id);
  if (filters?.deliverable_type) query = query.eq("deliverable_type", filters.deliverable_type);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.task_id) query = query.eq("task_id", filters.task_id);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list deliverables: ${error.message}`);
  return data || [];
}

export async function getDeliverable(
  supabase: SupabaseClient,
  deliverableId: string
): Promise<AgentDeliverable | null> {
  const { data, error } = await supabase
    .from("agent_deliverables")
    .select("*, agent:agents!agent_deliverables_agent_id_fkey(*)")
    .eq("id", deliverableId)
    .single();

  if (error) return null;
  return data;
}

// --- Formatting ---

export function formatMemoriesForPrompt(memories: CoreMemory[]): string {
  if (memories.length === 0) return "";

  const grouped: Record<string, CoreMemory[]> = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  }

  const categoryLabels: Record<string, string> = {
    targeting: "Segmentacao / Publico-alvo",
    budget: "Orcamentos e Budgets",
    naming: "Convencoes de Nomenclatura",
    preference: "Preferencias do Usuario",
    general: "Informacoes Gerais",
  };

  const sections: string[] = [];
  for (const [category, items] of Object.entries(grouped)) {
    const label = categoryLabels[category] || category;
    const lines = items.map((m) => `- ${m.key}: ${m.value}`);
    sections.push(`### ${label}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

// --- Saved Creatives ---

export interface SavedCreative {
  id: string;
  workspace_id: string;
  account_id: string;
  account_name: string | null;
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  campaign_id: string | null;
  adset_name: string | null;
  adset_id: string | null;
  creative_id: string | null;
  title: string | null;
  body: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  video_id: string | null;
  cta: string | null;
  format: string | null;
  destination_url: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  revenue: number;
  purchases: number;
  roas: number;
  tier: string | null;
  notes: string | null;
  tags: string[];
  saved_by: string | null;
  saved_at: string;
  date_range: string | null;
}

export async function listSavedCreatives(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: {
    tier?: string;
    tags?: string[];
    format?: string;
    min_roas?: number;
    account_id?: string;
    limit?: number;
  }
): Promise<SavedCreative[]> {
  let query = supabase
    .from("saved_creatives")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (filters?.tier) {
    query = query.eq("tier", filters.tier);
  }
  if (filters?.account_id) {
    query = query.eq("account_id", filters.account_id);
  }
  if (filters?.format) {
    query = query.eq("format", filters.format);
  }
  if (filters?.min_roas) {
    query = query.gte("roas", filters.min_roas);
  }
  if (filters?.tags && filters.tags.length > 0) {
    query = query.overlaps("tags", filters.tags);
  }

  const { data, error } = await query
    .order("roas", { ascending: false })
    .limit(filters?.limit || 50);

  if (error) throw new Error(`Failed to list saved creatives: ${error.message}`);
  return data || [];
}

export async function syncSavedCreatives(
  supabase: SupabaseClient,
  workspaceId: string,
  ads: Array<{
    account_id?: string;
    account_name?: string;
    ad_id: string;
    ad_name: string;
    campaign_name: string;
    campaign_id: string;
    adset_name: string;
    adset_id: string;
    creative_id: string;
    title: string;
    body: string;
    image_url: string;
    thumbnail_url: string;
    video_id: string;
    cta: string;
    format: string;
    destination_url: string;
    impressions: number;
    clicks: number;
    spend: number;
    reach: number;
    ctr: number;
    cpc: number;
    cpm: number;
    revenue: number;
    purchases: number;
    roas: number;
    tier?: string | null;
  }>,
  dateRange: string
): Promise<void> {
  const rows = ads.map((ad) => ({
    workspace_id: workspaceId,
    account_id: ad.account_id || "",
    account_name: ad.account_name || null,
    ad_id: ad.ad_id,
    ad_name: ad.ad_name,
    campaign_name: ad.campaign_name,
    campaign_id: ad.campaign_id,
    adset_name: ad.adset_name,
    adset_id: ad.adset_id,
    creative_id: ad.creative_id,
    title: ad.title,
    body: ad.body,
    image_url: ad.image_url,
    thumbnail_url: ad.thumbnail_url,
    video_id: ad.video_id,
    cta: ad.cta,
    format: ad.format,
    destination_url: ad.destination_url,
    impressions: ad.impressions,
    clicks: ad.clicks,
    spend: ad.spend,
    reach: ad.reach,
    ctr: ad.ctr,
    cpc: ad.cpc,
    cpm: ad.cpm,
    revenue: ad.revenue,
    purchases: ad.purchases,
    roas: ad.roas,
    tier: ad.tier || null,
    saved_at: new Date().toISOString(),
    date_range: dateRange,
  }));

  const { error } = await supabase
    .from("saved_creatives")
    .upsert(rows, { onConflict: "workspace_id,ad_id" });

  if (error) {
    console.error("Failed to sync saved creatives:", error.message);
  }
}

export async function updateCreativeNote(
  supabase: SupabaseClient,
  creativeId: string,
  notes: string,
  tags?: string[]
): Promise<SavedCreative> {
  const updates: Record<string, unknown> = { notes };
  if (tags !== undefined) updates.tags = tags;

  const { data, error } = await supabase
    .from("saved_creatives")
    .update(updates)
    .eq("id", creativeId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update creative note: ${error.message}`);
  return data;
}

export async function getSavedCreativeTiers(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("saved_creatives")
    .select("ad_id, tier")
    .eq("workspace_id", workspaceId)
    .not("tier", "is", null);

  if (error) throw new Error(`Failed to get saved tiers: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of data || []) {
    map[row.ad_id] = row.tier;
  }
  return map;
}

// --- Saved Campaigns ---

export interface SavedCampaign {
  id: string;
  workspace_id: string;
  account_id: string;
  account_name: string | null;
  campaign_id: string;
  campaign_name: string;
  status: string | null;
  objective: string | null;
  daily_budget: string | null;
  lifetime_budget: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  revenue: number;
  purchases: number;
  roas: number;
  tier: string | null;
  notes: string | null;
  tags: string[];
  saved_at: string;
  date_range: string | null;
}

export async function listSavedCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: {
    tier?: string;
    min_roas?: number;
    account_id?: string;
    platform?: string;
    limit?: number;
  }
): Promise<SavedCampaign[]> {
  let query = supabase
    .from("saved_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (filters?.tier) query = query.eq("tier", filters.tier);
  if (filters?.account_id) query = query.eq("account_id", filters.account_id);
  if (filters?.platform) query = query.eq("platform", filters.platform);
  if (filters?.min_roas) query = query.gte("roas", filters.min_roas);

  const { data, error } = await query
    .order("roas", { ascending: false })
    .limit(filters?.limit || 50);

  if (error) throw new Error(`Failed to list saved campaigns: ${error.message}`);
  return data || [];
}

export async function syncSavedCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
  campaigns: Array<{
    account_id?: string;
    account_name?: string;
    id: string;
    name: string;
    status: string;
    objective: string;
    daily_budget?: string;
    lifetime_budget?: string;
    impressions: number;
    clicks: number;
    spend: number;
    reach: number;
    ctr: number;
    cpc: number;
    cpm: number;
    revenue: number;
    purchases: number;
    roas: number;
    tier?: string | null;
  }>,
  dateRange: string,
  platform: "meta" | "google" = "meta"
): Promise<void> {
  const rows = campaigns.map((c) => ({
    workspace_id: workspaceId,
    account_id: c.account_id || "",
    account_name: c.account_name || null,
    campaign_id: c.id,
    campaign_name: c.name,
    status: c.status,
    objective: c.objective,
    daily_budget: c.daily_budget || null,
    lifetime_budget: c.lifetime_budget || null,
    impressions: c.impressions,
    clicks: c.clicks,
    spend: c.spend,
    reach: c.reach,
    ctr: c.ctr,
    cpc: c.cpc,
    cpm: c.cpm,
    revenue: c.revenue,
    purchases: c.purchases,
    roas: c.roas,
    tier: c.tier || null,
    saved_at: new Date().toISOString(),
    date_range: dateRange,
    platform,
  }));

  const { error } = await supabase
    .from("saved_campaigns")
    .upsert(rows, { onConflict: "workspace_id,platform,campaign_id" });

  if (error) {
    console.error("Failed to sync saved campaigns:", error.message);
  }
}

export async function updateCampaignNote(
  supabase: SupabaseClient,
  campaignId: string,
  notes: string,
  tags?: string[]
): Promise<SavedCampaign> {
  const updates: Record<string, unknown> = { notes };
  if (tags !== undefined) updates.tags = tags;

  const { data, error } = await supabase
    .from("saved_campaigns")
    .update(updates)
    .eq("id", campaignId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update campaign note: ${error.message}`);
  return data;
}

// --- Marketing Actions ---

export interface MarketingAction {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  category: string;
  start_date: string;
  end_date: string;
  status: string;
  content: { images?: string[]; links?: string[]; notes?: string };
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  campanha: "#EF4444",
  conteudo: "#8B5CF6",
  social: "#EC4899",
  email: "#F59E0B",
  seo: "#22C55E",
  lancamento: "#6366F1",
  evento: "#14B8A6",
  geral: "#3B82F6",
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.geral;
}

export async function createMarketingAction(
  supabase: SupabaseClient,
  workspaceId: string,
  params: {
    title: string;
    description?: string;
    category?: string;
    start_date: string;
    end_date: string;
    status?: string;
    content?: object;
    created_by?: string;
  }
): Promise<MarketingAction> {
  const { data, error } = await supabase
    .from("marketing_actions")
    .insert({
      workspace_id: workspaceId,
      title: params.title,
      description: params.description || "",
      category: params.category || "geral",
      start_date: params.start_date,
      end_date: params.end_date,
      status: params.status || "planned",
      content: params.content || {},
      created_by: params.created_by || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create marketing action: ${error.message}`);
  return data;
}

export async function listMarketingActions(
  supabase: SupabaseClient,
  workspaceId: string,
  filters?: {
    start?: string;
    end?: string;
    category?: string;
    status?: string;
  }
): Promise<MarketingAction[]> {
  let query = supabase
    .from("marketing_actions")
    .select("*")
    .eq("workspace_id", workspaceId);

  // Overlap filter: start_date <= end AND end_date >= start
  if (filters?.start) query = query.gte("end_date", filters.start);
  if (filters?.end) query = query.lte("start_date", filters.end);
  if (filters?.category) query = query.eq("category", filters.category);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query.order("start_date", { ascending: true });

  if (error) throw new Error(`Failed to list marketing actions: ${error.message}`);
  return data || [];
}

export async function getMarketingAction(
  supabase: SupabaseClient,
  actionId: string
): Promise<MarketingAction | null> {
  const { data, error } = await supabase
    .from("marketing_actions")
    .select("*")
    .eq("id", actionId)
    .single();

  if (error) return null;
  return data;
}

export async function updateMarketingAction(
  supabase: SupabaseClient,
  actionId: string,
  updates: {
    title?: string;
    description?: string;
    category?: string;
    start_date?: string;
    end_date?: string;
    status?: string;
    content?: object;
  }
): Promise<MarketingAction> {
  const { data, error } = await supabase
    .from("marketing_actions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update marketing action: ${error.message}`);
  return data;
}

export async function deleteMarketingAction(
  supabase: SupabaseClient,
  actionId: string
): Promise<void> {
  const { error } = await supabase
    .from("marketing_actions")
    .delete()
    .eq("id", actionId);

  if (error) throw new Error(`Failed to delete marketing action: ${error.message}`);
}
