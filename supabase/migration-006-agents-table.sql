-- Migration 006: Agents table (multi-agent foundation)
-- Creates a central agents entity. The existing Vortex becomes the default agent.

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Vortex',
  slug text NOT NULL DEFAULT 'vortex',
  description text DEFAULT 'Assistente inteligente de Meta Ads',
  avatar_color text DEFAULT '#8B5CF6',
  model_preference text NOT NULL DEFAULT 'auto' CHECK (model_preference IN ('auto', 'sonnet', 'haiku', 'opus')),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique slug per workspace
CREATE UNIQUE INDEX idx_agents_workspace_slug ON public.agents(workspace_id, slug);

-- Only one default agent per workspace
CREATE UNIQUE INDEX idx_agents_default ON public.agents(workspace_id) WHERE is_default = true;

-- General lookup
CREATE INDEX idx_agents_workspace ON public.agents(workspace_id, status);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace agents"
  ON public.agents FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace agents"
  ON public.agents FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace agents"
  ON public.agents FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace agents"
  ON public.agents FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- Seed: create default Vortex agent for workspaces that already have agent_documents
INSERT INTO public.agents (workspace_id, name, slug, description, is_default, status)
SELECT DISTINCT workspace_id, 'Vortex', 'vortex', 'Assistente inteligente de Meta Ads', true, 'active'
FROM public.agent_documents
ON CONFLICT DO NOTHING;

-- Add agent_id FK to related tables (nullable for backward compatibility)
ALTER TABLE public.agent_documents ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;
ALTER TABLE public.agent_core_memory ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE;

-- Backfill: link existing records to the default agent
UPDATE public.agent_documents d
SET agent_id = a.id
FROM public.agents a
WHERE a.workspace_id = d.workspace_id AND a.is_default = true AND d.agent_id IS NULL;

UPDATE public.agent_core_memory m
SET agent_id = a.id
FROM public.agents a
WHERE a.workspace_id = m.workspace_id AND a.is_default = true AND m.agent_id IS NULL;

UPDATE public.agent_conversations c
SET agent_id = a.id
FROM public.agents a
WHERE a.workspace_id = c.workspace_id AND a.is_default = true AND c.agent_id IS NULL;
