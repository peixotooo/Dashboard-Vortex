-- Migration 038: Per-member feature permissions
-- Adds a features column to workspace_members and workspace_invitations
-- to control which dashboard features a member can access.
-- NULL = all features (backwards compatible, default behavior).
-- An array like '["meta_ads","crm"]' restricts to listed features only.

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS features jsonb DEFAULT NULL;

ALTER TABLE public.workspace_invitations
  ADD COLUMN IF NOT EXISTS features jsonb DEFAULT NULL;

-- Allow admins/owners to update members (e.g. change features)
CREATE POLICY "Admins and owners can update members"
  ON public.workspace_members FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
