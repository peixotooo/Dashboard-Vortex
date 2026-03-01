-- Migration 009: Projects + Task-Project Linking + Compilation Support
-- Groups tasks into projects for traceability and auto-compilation

-- 1. Create agent_projects table
CREATE TABLE IF NOT EXISTS public.agent_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'done')),
  created_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_agent_projects_workspace ON public.agent_projects(workspace_id, status);

ALTER TABLE public.agent_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace projects"
  ON public.agent_projects FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace projects"
  ON public.agent_projects FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace projects"
  ON public.agent_projects FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace projects"
  ON public.agent_projects FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- 2. Add project_id FK to agent_tasks
ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.agent_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON public.agent_tasks(project_id);

-- 3. Add project_id FK to agent_deliverables
ALTER TABLE public.agent_deliverables
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.agent_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_deliverables_project ON public.agent_deliverables(project_id);

-- 4. Add 'compiled' to deliverable_type check constraint
ALTER TABLE public.agent_deliverables
  DROP CONSTRAINT IF EXISTS agent_deliverables_deliverable_type_check;

ALTER TABLE public.agent_deliverables
  ADD CONSTRAINT agent_deliverables_deliverable_type_check
  CHECK (deliverable_type IN ('calendar', 'copy', 'audit', 'strategy', 'report', 'email_sequence', 'general', 'compiled'));
