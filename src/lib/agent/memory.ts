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
  title?: string
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({
      workspace_id: workspaceId,
      account_id: accountId,
      user_id: userId,
      title: title || null,
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
  limit = 20
): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(limit);

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

  // Check if agents already exist for this workspace
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

  // Update existing agents (name, description, avatar_color) in case they changed
  for (const agentDef of TEAM_AGENTS) {
    if (!existingSlugs.has(agentDef.slug)) continue;

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
