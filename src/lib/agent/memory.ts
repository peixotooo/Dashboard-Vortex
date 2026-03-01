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
