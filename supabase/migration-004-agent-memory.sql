-- Migration 004: Agent Memory System
-- Creates tables for core memory, conversations, and messages

-- ============================================
-- Table 1: agent_core_memory (permanent facts)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_core_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  category text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, account_id, category, key)
);

ALTER TABLE public.agent_core_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace core memory"
  ON public.agent_core_memory FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace core memory"
  ON public.agent_core_memory FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace core memory"
  ON public.agent_core_memory FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace core memory"
  ON public.agent_core_memory FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE INDEX idx_core_memory_workspace_account
  ON public.agent_core_memory(workspace_id, account_id);

-- ============================================
-- Table 2: agent_conversations (chat sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace conversations"
  ON public.agent_conversations FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace conversations"
  ON public.agent_conversations FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace conversations"
  ON public.agent_conversations FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace conversations"
  ON public.agent_conversations FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE INDEX idx_conversations_workspace_account
  ON public.agent_conversations(workspace_id, account_id);

CREATE INDEX idx_conversations_updated
  ON public.agent_conversations(workspace_id, updated_at DESC);

-- ============================================
-- Table 3: agent_messages (individual messages)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view messages in workspace conversations"
  ON public.agent_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM public.agent_conversations
      WHERE workspace_id IN (SELECT public.get_user_workspace_ids())
    )
  );

CREATE POLICY "Members can insert messages in workspace conversations"
  ON public.agent_messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.agent_conversations
      WHERE workspace_id IN (SELECT public.get_user_workspace_ids())
    )
  );

CREATE INDEX idx_messages_conversation
  ON public.agent_messages(conversation_id, created_at);
