-- Migration 070: Marketing planning_type
-- Splits marketing actions into Social Media vs Performance for visual separation
-- in /team/planning. Default 'social' to preserve historical UX where most
-- existing actions are organic/social-flavored.

ALTER TABLE public.marketing_actions
  ADD COLUMN IF NOT EXISTS planning_type text NOT NULL DEFAULT 'social'
    CHECK (planning_type IN ('social','performance'));

CREATE INDEX IF NOT EXISTS idx_mktg_actions_planning_type
  ON public.marketing_actions(workspace_id, planning_type);
