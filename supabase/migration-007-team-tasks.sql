-- Migration 007: Team Tasks + Deliverables
-- Adds kanban task management and formatted deliverables for multi-agent team

-- Tasks (kanban board)
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  created_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  task_type text NOT NULL DEFAULT 'general' CHECK (task_type IN ('copy', 'seo', 'social_calendar', 'campaign', 'cro', 'strategy', 'revenue', 'general')),
  due_date timestamptz,
  completed_at timestamptz,
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_agent_tasks_workspace ON public.agent_tasks(workspace_id, status);
CREATE INDEX idx_agent_tasks_agent ON public.agent_tasks(agent_id, status);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace tasks"
  ON public.agent_tasks FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace tasks"
  ON public.agent_tasks FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace tasks"
  ON public.agent_tasks FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace tasks"
  ON public.agent_tasks FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- Deliverables (formatted outputs)
CREATE TABLE IF NOT EXISTS public.agent_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  deliverable_type text NOT NULL DEFAULT 'general' CHECK (deliverable_type IN ('calendar', 'copy', 'audit', 'strategy', 'report', 'email_sequence', 'general')),
  format text NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown', 'json')),
  metadata jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_agent_deliverables_workspace ON public.agent_deliverables(workspace_id, deliverable_type);
CREATE INDEX idx_agent_deliverables_agent ON public.agent_deliverables(agent_id);
CREATE INDEX idx_agent_deliverables_task ON public.agent_deliverables(task_id);

ALTER TABLE public.agent_deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace deliverables"
  ON public.agent_deliverables FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can insert workspace deliverables"
  ON public.agent_deliverables FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can update workspace deliverables"
  ON public.agent_deliverables FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "Members can delete workspace deliverables"
  ON public.agent_deliverables FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
