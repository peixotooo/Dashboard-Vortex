-- supabase/migration-068-email-template-drafts.sql
--
-- Persists user-edited email drafts produced by the block-based editor.
-- Each draft is a versioned snapshot: workspace + name + meta + ordered
-- block list + optional layout the draft was seeded from.

create table if not exists email_template_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  layout_id text,
  name text not null,
  meta jsonb not null,
  blocks jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_template_drafts_workspace_updated_idx
  on email_template_drafts (workspace_id, updated_at desc);
