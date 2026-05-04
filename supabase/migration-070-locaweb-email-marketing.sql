-- supabase/migration-070-locaweb-email-marketing.sql
--
-- Per-workspace Locaweb Email Marketing config + per-suggestion + per-draft
-- dispatch tracking. Lets the dashboard send a draft to a Locaweb list and
-- reconcile delivery/open/click/bounce stats.

create table if not exists workspace_email_marketing (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  -- Credentials. Falls back to LOCAWEB_EM_* env vars when null (single-tenant
  -- deploys). Tokens are static long-lived strings; keep them out of source.
  locaweb_base_url text default 'https://emailmarketing.locaweb.com.br/api/v1',
  locaweb_account_id text,
  locaweb_token text,
  -- Verified sending identity
  default_sender_email text,
  default_sender_name text,
  default_domain_id text,
  -- RFM cluster -> Locaweb list_id (JSONB so we can grow clusters without
  -- migrations). Example shape:
  --   { "Champions": "abc...", "Loyal": "def...", "At Risk": "ghi..." }
  list_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Track which Locaweb message a dispatched draft maps to. Lets the stats-sync
-- cron pull overview/bounces/clicks per dispatched email and roll the
-- aggregate into the editor's history view.
create table if not exists email_template_dispatches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  draft_id uuid references email_template_drafts(id) on delete set null,
  suggestion_id uuid references email_template_suggestions(id) on delete set null,
  locaweb_message_id text not null,
  locaweb_list_ids text[] not null default '{}',
  scheduled_to timestamptz,
  status text not null default 'queued'
    check (status in ('queued','scheduled','sending','sent','failed','canceled')),
  -- Aggregates pulled by the stats-sync cron
  stats jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_template_dispatches_workspace_idx
  on email_template_dispatches (workspace_id, created_at desc);

create index if not exists email_template_dispatches_message_idx
  on email_template_dispatches (locaweb_message_id);
