-- Migration 005: Agent Documents (soul, agent_rules, user_profile, daily_summary)
-- Stores dynamic personality, behavioral rules, and user profiles for OpenClaw-inspired memory

CREATE TABLE IF NOT EXISTS public.agent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id text,
  doc_type text NOT NULL CHECK (doc_type IN ('soul', 'agent_rules', 'user_profile', 'daily_summary')),
  content text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_documents ENABLE ROW LEVEL SECURITY;

-- Unique: one soul/agent_rules/user_profile per workspace+account combo
CREATE UNIQUE INDEX idx_agent_documents_unique_type
  ON public.agent_documents(workspace_id, COALESCE(account_id, '__global__'), doc_type)
  WHERE doc_type IN ('soul', 'agent_rules', 'user_profile');

-- Index for daily summaries (many per workspace+account, ordered by date)
CREATE INDEX idx_agent_documents_daily
  ON public.agent_documents(workspace_id, account_id, doc_type, created_at DESC)
  WHERE doc_type = 'daily_summary';

-- General lookup index
CREATE INDEX idx_agent_documents_lookup
  ON public.agent_documents(workspace_id, account_id, doc_type);

-- RLS policies
CREATE POLICY "Members can view workspace agent documents"
  ON public.agent_documents FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace agent documents"
  ON public.agent_documents FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace agent documents"
  ON public.agent_documents FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace agent documents"
  ON public.agent_documents FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
