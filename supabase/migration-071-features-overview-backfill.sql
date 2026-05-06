-- Migration 071: Backfill 'overview' on workspace_members.features and
-- workspace_invitations.features.
--
-- Context: features.ts now treats Overview ("/") as a togglable feature.
-- Existing members with a non-null features array predate this change and
-- implicitly had Overview access, so we add 'overview' to keep them landing
-- on "/" by default. Members with features = null (full access) and
-- owners/admins are unaffected — RLS / canAccessPath already grant them
-- everything.

UPDATE public.workspace_members
SET features = features || '["overview"]'::jsonb
WHERE features IS NOT NULL
  AND NOT (features @> '["overview"]'::jsonb);

UPDATE public.workspace_invitations
SET features = features || '["overview"]'::jsonb
WHERE features IS NOT NULL
  AND NOT (features @> '["overview"]'::jsonb);
