-- Migration 018: Marketing Actions (Calendar Planning)
-- Dedicated table for monthly marketing planning with date ranges
-- Serves as knowledge base for all agents via project_context sync

CREATE TABLE IF NOT EXISTS public.marketing_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'geral'
    CHECK (category IN ('campanha','conteudo','social','email','seo','lancamento','evento','geral')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','done','cancelled')),
  content jsonb DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_mktg_actions_ws ON public.marketing_actions(workspace_id);
CREATE INDEX idx_mktg_actions_dates ON public.marketing_actions(workspace_id, start_date, end_date);

ALTER TABLE public.marketing_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws_select" ON public.marketing_actions FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "ws_insert" ON public.marketing_actions FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "ws_update" ON public.marketing_actions FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

CREATE POLICY "ws_delete" ON public.marketing_actions FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
